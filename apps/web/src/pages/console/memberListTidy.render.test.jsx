// Tidying up members whose membership is over, on the Members list (ROADMAP 21c-iii;
// RULINGS 2026-10-11): the sign, the list it opens, and Renew, Remove and Keep on
// list for one person or for the people ticked. The worst thing, first: a Remove pressed
// from that list that could move somebody whose membership is not over.
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup, fireEvent, within } from '@testing-library/react';
import { memberListEntriesPageSchema, memberListViewSchema } from '@app/shared';

// The Remove box has its own tests (`memberListRemove.render.test.jsx`). Here it reads its
// box when it opens and has one button that presses, so what the list asks for is seen.
vi.mock('./MemberListRemove', () => ({
  default: ({ load, press, onRemoved, onClose }) => {
    void load();
    return (
      <div data-testid="remove-box">
        <button
          type="button"
          onClick={() => {
            void press('d'.repeat(64), false).then(() => {
              onRemoved();
              onClose();
            });
          }}
        >
          Press remove
        </button>
      </div>
    );
  },
}));
// A person's page has its own tests; here it shows who it was opened for, and how.
vi.mock('./MemberListPerson', () => ({
  default: ({ entryId, addMembership, onClose }) => (
    <div data-testid="person-page" data-entry={entryId} data-add={String(addMembership)}>
      <button type="button" onClick={onClose}>
        Close person
      </button>
    </div>
  ),
}));

vi.mock('../../api/orgsApi', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    orgService: {
      getMemberList: vi.fn(),
      getMemberListEntries: vi.fn(),
      getInvitePreview: vi.fn(),
      getGymTags: vi.fn(),
      selectAllMembers: vi.fn(),
      previewRemoveSelected: vi.fn(),
      removeSelected: vi.fn(),
      keepMembersListed: vi.fn(),
    },
  };
});

const { orgService } = await import('../../api/orgsApi');
const MemberListPanel = (await import('./MemberListPanel')).default;

const GYM = '11111111-1111-4111-8111-111111111111';
const WORDS = { people: 'members', person: 'member', peopleCap: 'Members', it: 'gym' };
const GYM_ROW = { id: GYM, name: 'Iron House Gym', slug: 'iron-house', timezone: 'Europe/London' };
const DIGEST = 'a'.repeat(64);

const viewWith = (over, owing = 0) =>
  memberListViewSchema.parse({
    hasList: true,
    version: 3,
    lastConfirmedAt: '2026-09-20T10:00:00.000Z',
    counts: { entries: 40, inApp: 0, canBeInvited: 40, noEmail: 0, former: 0 },
    statuses: [
      { label: 'Active', count: 37, inApp: 0, canBeInvited: 37 },
      { label: 'Ended', count: 3, inApp: 0, canBeInvited: 3 },
    ],
    membershipTypes: [],
    paymentStatuses: [],
    fields: [],
    appWords: [{ word: 'not_in_app', count: 40 }],
    over: { count: over, owing },
  });

let n = 0;
const entry = (fullName, held = null) => {
  n += 1;
  return {
    entryId: `aaaaaaaa-aaaa-4aaa-8aaa-${String(n).padStart(12, '0')}`,
    fullName,
    email: `${fullName.split(' ')[0].toLowerCase()}@members.example`,
    phone: null,
    memberNumber: null,
    status: null,
    membershipType: null,
    joinedOn: null,
    endsOn: null,
    endsOnKind: null,
    paymentStatus: null,
    dateOfBirth: null,
    held,
    formerAt: null,
    source: 'upload',
    inApp: false,
    invitation: null,
    app: { word: 'not_in_app', tone: 'grey', at: null, line: 'Not invited yet', lineTone: 'plain' },
  };
};
const ended = (on) => ({ status: 'ended', memberships: ['1 Month'], day: { what: 'ended', on }, payment: null });
const pageOf = (entries, total = entries.length) => ({ data: { page: memberListEntriesPageSchema.parse({ total, entries, cursor: null }) } });

let paula;
let yara;
let cal;
let jude;

const draw = (props = {}) => render(<MemberListPanel gymId={GYM} gym={GYM_ROW} words={WORDS} readOnly={false} refreshKey={0} {...props} />);
const sign = () => within(screen.getByTestId('over-sign'));
const rowOf = (name) => within(screen.getByText(name).closest('li'));
/** Open the list the sign points at. */
const review = async () => {
  draw();
  await screen.findByText('Paula Paid');
  fireEvent.click(sign().getByTestId('over-review'));
  await screen.findAllByTestId('over-actions');
  await waitFor(() => expect(screen.queryByText('Paula Paid')).toBeNull());
};

beforeEach(() => {
  vi.resetAllMocks();
  paula = entry('Paula Paid', { status: 'active', memberships: ['Gold Monthly'], day: { what: 'renews', on: '2026-11-01' }, payment: { state: 'paid' } });
  yara = entry('Yara Yesterday', ended('2026-10-14'));
  cal = entry('Cal Cancelled', { status: 'cancelled', memberships: ['Gold Monthly'], day: { what: 'cancelled', on: '2026-10-03' }, payment: null });
  jude = entry('Jude July', ended('2026-07-16'));
  orgService.getMemberList.mockResolvedValue({ data: { list: viewWith(3) } });
  // The whole list, or only the people whose membership is over, as the server would cut it.
  orgService.getMemberListEntries.mockImplementation((gymId, query) =>
    Promise.resolve(new URLSearchParams(query).get('membership') === 'over' ? pageOf([cal, jude, yara]) : pageOf([cal, jude, paula, yara], 40)),
  );
  orgService.getInvitePreview.mockRejectedValue(new Error('not asked here'));
  orgService.getGymTags.mockResolvedValue({ data: { tags: [] } });
  orgService.previewRemoveSelected.mockResolvedValue({ data: { preview: {} } });
  orgService.removeSelected.mockResolvedValue({ data: { removed: { moved: 1, endedApp: 0, alreadyRemoved: false } } });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('tidying up members whose membership is over', () => {
  it('the worst thing: every Remove pressed from the sign’s list tells the server to move only people whose membership is over, and the whole list’s Remove does not', async () => {
    await review();
    // One person, by the button under their own row.
    fireEvent.click(rowOf('Cal Cancelled').getByTestId('over-remove'));
    await screen.findByTestId('remove-box');
    const one = { kind: 'ticked', entryIds: [cal.entryId] };
    expect(orgService.previewRemoveSelected).toHaveBeenLastCalledWith(GYM, one, true);
    fireEvent.click(screen.getByText('Press remove'));
    await waitFor(() => expect(orgService.removeSelected).toHaveBeenLastCalledWith(GYM, one, 'd'.repeat(64), false, true));
    await waitFor(() => expect(screen.queryByTestId('remove-box')).toBeNull());

    // Everybody at once: tick the page, Select all is not needed for three, then Remove.
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select every member on this page' }));
    // With people ticked the buttons under each row give way to the bar's.
    expect(screen.queryAllByTestId('over-actions')).toEqual([]);
    fireEvent.click(within(screen.getByTestId('sel-bar')).getByTestId('bar-remove'));
    await screen.findByTestId('remove-box');
    const three = { kind: 'ticked', entryIds: [cal.entryId, jude.entryId, yara.entryId] };
    expect(orgService.previewRemoveSelected).toHaveBeenLastCalledWith(GYM, three, true);
    fireEvent.click(screen.getByText('Press remove'));
    await waitFor(() => expect(orgService.removeSelected).toHaveBeenLastCalledWith(GYM, three, 'd'.repeat(64), false, true));
    await waitFor(() => expect(screen.queryByTestId('remove-box')).toBeNull());

    // Back on the whole list, Remove is the ordinary one: whoever staff tick, named first.
    fireEvent.click(screen.getByRole('button', { name: 'Stop showing only Membership ended or cancelled' }));
    await screen.findByText('Paula Paid');
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Paula Paid' }));
    fireEvent.click(within(screen.getByTestId('sel-bar')).getByTestId('bar-remove'));
    await screen.findByTestId('remove-box');
    expect(orgService.previewRemoveSelected).toHaveBeenLastCalledWith(GYM, { kind: 'ticked', entryIds: [paula.entryId] });
    fireEvent.click(screen.getByText('Press remove'));
    await waitFor(() => expect(orgService.removeSelected).toHaveBeenLastCalledWith(GYM, { kind: 'ticked', entryIds: [paula.entryId] }, 'd'.repeat(64), false));
  });

  it('the sign says how many, and Review them shows only those people, each with the three things staff can do', async () => {
    draw();
    await screen.findByText('Paula Paid');
    expect(sign().getByText('3 memberships have ended or been cancelled')).toBeTruthy();
    expect(sign().getByText('These members are still on your member list. Reports already counts them as having left.')).toBeTruthy();
    // On the whole list no row has the buttons.
    expect(screen.queryAllByTestId('over-actions')).toEqual([]);

    fireEvent.click(sign().getByRole('button', { name: 'Review them' }));
    await screen.findAllByTestId('over-actions');
    expect(orgService.getMemberListEntries).toHaveBeenLastCalledWith(GYM, 'membership=over');
    expect(within(screen.getByTestId('showing')).getByText('Membership ended or cancelled')).toBeTruthy();
    expect(screen.getByTestId('list-total').textContent).toBe('3 members match');
    // The sign stays, and now says what to do; its button has done its job.
    expect(sign().queryByTestId('over-review')).toBeNull();
    expect(
      sign().getByText('For each member, renew their membership, remove them from your list, or keep them on it. To do the same for several at once, tick them first.'),
    ).toBeTruthy();
    for (const name of ['Cal Cancelled', 'Jude July', 'Yara Yesterday']) {
      expect(rowOf(name).getByRole('button', { name: `Renew ${name}'s membership` }).textContent).toBe('Renew');
      expect(rowOf(name).getByRole('button', { name: `Remove ${name}` }).textContent).toBe('Remove');
      expect(rowOf(name).getByRole('button', { name: `Keep ${name} on your list` }).textContent).toBe('Keep on list');
    }
  });

  it('one membership reads in the singular, and no sign is shown when nobody is over', async () => {
    orgService.getMemberList.mockResolvedValue({ data: { list: viewWith(1) } });
    draw();
    await screen.findByText('Paula Paid');
    expect(sign().getByText('1 membership has ended or been cancelled')).toBeTruthy();
    expect(sign().getByRole('button', { name: 'Review it' })).toBeTruthy();
    expect(sign().getByText('This member is still on your member list. Reports already counts them as having left.')).toBeTruthy();
    cleanup();

    orgService.getMemberList.mockResolvedValue({ data: { list: viewWith(0) } });
    draw();
    await screen.findByText('Paula Paid');
    expect(screen.queryByTestId('over-sign')).toBeNull();
  });

  it('Keep on list under a row keeps that one person, says so above the list, and reads the list again', async () => {
    await review();
    orgService.keepMembersListed.mockResolvedValue({ data: { done: { kept: 1, already: 0, notOver: 0 } } });
    orgService.getMemberList.mockResolvedValue({ data: { list: viewWith(2) } });
    orgService.getMemberListEntries.mockResolvedValue(pageOf([cal, yara]));
    fireEvent.click(rowOf('Jude July').getByTestId('over-keep'));
    await waitFor(() => expect(orgService.keepMembersListed).toHaveBeenCalledWith(GYM, { kind: 'ticked', entryIds: [jude.entryId] }));
    expect((await screen.findByTestId('tidy-note')).textContent).toBe(
      'Jude July stays on your list and is no longer counted here. You can still find them with Filter, under Status.',
    );
    await waitFor(() => expect(screen.queryByText('Jude July')).toBeNull());
    await waitFor(() => expect(sign().getByText('2 memberships have ended or been cancelled')).toBeTruthy());
    // No box was opened: nothing about the person changed.
    expect(screen.queryByTestId('remove-box')).toBeNull();
  });

  it('Keep on list in the bar keeps everyone a Select all chose, by its own filter', async () => {
    orgService.getMemberListEntries.mockImplementation((gymId, query) =>
      Promise.resolve(new URLSearchParams(query).get('membership') === 'over' ? pageOf([cal, jude, yara], 120) : pageOf([cal, jude, paula, yara], 400)),
    );
    await review();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select every member on this page' }));
    orgService.selectAllMembers.mockResolvedValue({ data: { selection: { count: 120, digest: DIGEST } } });
    fireEvent.click(screen.getByTestId('select-everyone'));
    await waitFor(() => expect(orgService.selectAllMembers).toHaveBeenCalledWith(GYM, { membership: 'over' }));
    await screen.findByText('All 120 members that match are selected.');
    orgService.keepMembersListed.mockResolvedValue({ data: { done: { kept: 117, already: 1, notOver: 2 } } });
    fireEvent.click(within(screen.getByTestId('sel-bar')).getByTestId('bar-keep'));
    const everyone = { kind: 'all', filter: { membership: 'over' }, count: 120, digest: DIGEST };
    await waitFor(() => expect(orgService.keepMembersListed).toHaveBeenCalledWith(GYM, everyone));
    expect((await screen.findByTestId('tidy-note')).textContent).toBe(
      '117 members stay on your list and are no longer counted here. You can still find them with Filter, under Status. 1 was already kept on your list. 2 are no longer on this list.',
    );
    // The bar has no Keep on list on the whole list.
    fireEvent.click(screen.getByRole('button', { name: 'Stop showing only Membership ended or cancelled' }));
    await screen.findByText('Paula Paid');
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Paula Paid' }));
    expect(within(screen.getByTestId('sel-bar')).queryByTestId('bar-keep')).toBeNull();
  });

  it('a colleague kept them first: the line says so, and never that their membership is not over', async () => {
    await review();
    orgService.keepMembersListed.mockResolvedValue({ data: { done: { kept: 0, already: 1, notOver: 0 } } });
    orgService.getMemberListEntries.mockResolvedValue(pageOf([cal, yara]));
    fireEvent.click(rowOf('Jude July').getByTestId('over-keep'));
    expect((await screen.findByTestId('tidy-note')).textContent).toBe('Nothing was changed. 1 was already kept on your list.');
    // The list is read again all the same, so the row a colleague dealt with goes.
    await waitFor(() => expect(screen.queryByText('Jude July')).toBeNull());
  });

  it('a Select all that moved keeps nobody and says so', async () => {
    await review();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Cal Cancelled' }));
    orgService.keepMembersListed.mockRejectedValue({ response: { status: 409, data: { error: 'selection_changed', message: 'x', count: 2, digest: DIGEST } } });
    fireEvent.click(within(screen.getByTestId('sel-bar')).getByTestId('bar-keep'));
    expect((await screen.findByTestId('tidy-note')).textContent).toBe('The members you selected have changed, so nothing was done. 2 are selected now.');
  });

  it('Renew opens that person’s page with the Add membership form open, and a row’s own press opens it without', async () => {
    await review();
    fireEvent.click(rowOf('Yara Yesterday').getByTestId('over-add'));
    const page = await screen.findByTestId('person-page');
    expect([page.getAttribute('data-entry'), page.getAttribute('data-add')]).toEqual([yara.entryId, 'true']);
    fireEvent.click(screen.getByText('Close person'));
    fireEvent.click(rowOf('Yara Yesterday').getByTestId('list-row'));
    expect((await screen.findByTestId('person-page')).getAttribute('data-add')).toBe('false');
  });

  it('when the last person has been dealt with, the list says nobody is left and gives the way back', async () => {
    orgService.getMemberList.mockResolvedValue({ data: { list: viewWith(1) } });
    orgService.getMemberListEntries.mockImplementation((gymId, query) =>
      Promise.resolve(new URLSearchParams(query).get('membership') === 'over' ? pageOf([cal]) : pageOf([cal, paula], 40)),
    );
    await review();
    orgService.keepMembersListed.mockResolvedValue({ data: { done: { kept: 1, already: 0, notOver: 0 } } });
    orgService.getMemberList.mockResolvedValue({ data: { list: viewWith(0) } });
    orgService.getMemberListEntries.mockImplementation((gymId, query) =>
      Promise.resolve(new URLSearchParams(query).get('membership') === 'over' ? pageOf([]) : pageOf([cal, paula], 40)),
    );
    fireEvent.click(rowOf('Cal Cancelled').getByTestId('over-keep'));
    const done = within(await screen.findByTestId('over-done'));
    expect(done.getByText('Nobody is left to review. Members who still owe a payment, and members you kept on your list, are not shown here.')).toBeTruthy();
    expect(screen.queryByText('No members match.')).toBeNull();
    await waitFor(() => expect(screen.queryByTestId('over-sign')).toBeNull());
    fireEvent.click(done.getByRole('button', { name: 'Show all members' }));
    await screen.findByText('Paula Paid');
    expect(screen.queryByTestId('showing')).toBeNull();
  });

  it('people who still owe are held back, and the sign says so with a button that shows exactly them', async () => {
    const una = entry('Una Unpaid', { status: 'ended', memberships: ['1 Month'], day: { what: 'ended', on: '2026-08-31' }, payment: { state: 'due', since: '2026-08-01' } });
    orgService.getMemberList.mockResolvedValue({ data: { list: viewWith(3, 1) } });
    orgService.getMemberListEntries.mockImplementation((gymId, query) => {
      const asked = new URLSearchParams(query).get('membership');
      return Promise.resolve(asked === 'over_owing' ? pageOf([una]) : asked === 'over' ? pageOf([cal, jude, yara]) : pageOf([cal, jude, paula, una, yara], 40));
    });
    draw();
    await screen.findByText('Paula Paid');
    const held = within(screen.getByTestId('over-owing'));
    expect(
      held.getByText(
        '1 more member has a membership that is over and still owes a payment, so is not counted above. Record the payment or void the bill on their page first.',
      ),
    ).toBeTruthy();
    fireEvent.click(held.getByRole('button', { name: 'Show this member' }));
    await waitFor(() => expect(screen.queryByText('Paula Paid')).toBeNull());
    await screen.findByText('Una Unpaid');
    expect(orgService.getMemberListEntries).toHaveBeenLastCalledWith(GYM, 'membership=over_owing');
    expect(within(screen.getByTestId('showing')).getByText('Membership over, payment due')).toBeTruthy();
    // Her row opens her page, where the bill is; no Remove or Keep on list under it.
    expect(screen.queryAllByTestId('over-actions')).toEqual([]);
    expect(screen.queryByTestId('over-owing-show')).toBeNull();
    // The line now says where they are, and no longer that they are not counted above.
    expect(screen.getByTestId('over-owing').textContent).toBe(
      'The list below shows the 1 member whose membership is over and who still owes a payment. Record the payment or void the bill on their page first.',
    );
    // The sign's own list is still one press away.
    fireEvent.click(sign().getByRole('button', { name: 'Review them' }));
    await screen.findAllByTestId('over-actions');
    expect(screen.queryByText('Una Unpaid')).toBeNull();
    cleanup();

    // Nobody else to review: the sign is still there, about them alone.
    orgService.getMemberList.mockResolvedValue({ data: { list: viewWith(0, 2) } });
    draw();
    await screen.findByText('Paula Paid');
    expect(sign().getByText('2 members with a membership that is over still owe a payment')).toBeTruthy();
    expect(sign().queryByTestId('over-review')).toBeNull();
    expect(sign().getByRole('button', { name: 'Show these members' })).toBeTruthy();
  });

  it('a gym that can only read is shown who, and no button that changes anybody', async () => {
    draw({ readOnly: true });
    await screen.findByText('Paula Paid');
    fireEvent.click(sign().getByRole('button', { name: 'See who' }));
    await waitFor(() => expect(screen.queryByText('Paula Paid')).toBeNull());
    await screen.findByText('Cal Cancelled');
    expect(screen.queryAllByTestId('over-actions')).toEqual([]);
    expect(sign().getByText('These members are still on your member list. Reports already counts them as having left.')).toBeTruthy();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Cal Cancelled' }));
    const bar = within(screen.getByTestId('sel-bar'));
    expect(bar.queryByTestId('bar-keep')).toBeNull();
    expect(bar.queryByTestId('bar-remove')).toBeNull();
  });
});
