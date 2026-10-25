// Members in Square (ROADMAP 18d-iii-b-ii-b-i), a line of Square Point of Sale's checklist in Settings →
// Payments: the owner's press checks Square, the line says who is added, linked or left out and whom Square
// charges itself before anything changes, and Add does that.
//
// The worst thing this line could do is add or link people the owner was never shown, or let somebody other
// than the owner do it. So before the press of Add every group is named, the press names how many it adds
// and links, and the line is the owner's alone to press.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('../../api/orgsApi', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, orgService: { getSquareMembers: vi.fn(), checkSquareMembers: vi.fn(), addSquareMembers: vi.fn(), getSquareMembersNames: vi.fn() } };
});

const { orgService } = await import('../../api/orgsApi');
const SquareMembers = (await import('./SquareMembers')).default;
const { readOnlyNote } = await import('../../pages/console/billingView');

const ORG = { id: '11111111-1111-4111-8111-111111111111', slug: 'iron-house', name: 'Iron House', orgType: 'gym', staffRole: 'owner' };
const RUN = '22222222-2222-4222-8222-222222222222';
const group = (count = 0, names = []) => ({ count, names });
const GROUPS = { add: group(), link: group(), several_customers: group(), several_people: group(), billed: group(), refused: group(), waiting: group() };
const members = (over = {}) => ({
  state: 'none',
  runId: null,
  canAdd: true,
  automatic: false,
  looked: 0,
  unanswered: false,
  failure: null,
  checkedAt: null,
  expired: false,
  members: 5,
  inSquare: 0,
  progress: null,
  ...over,
  groups: { ...GROUPS, ...(over.groups ?? {}) },
});
const answer = (m) => ({ data: { members: m } });
const CHECKED = members({
  state: 'checked',
  runId: RUN,
  checkedAt: '2026-10-26T09:00:00.000Z',
  groups: {
    add: group(3, ['Amy Lee', 'Ben Ortiz', 'Sam Smith']),
    link: group(1, ['Leo Grant']),
    billed: group(1, ['Leo Grant']),
    several_customers: group(1, ['Nora Price']),
    several_people: group(2, ['Tom Reed', 'Tom Reed']),
  },
});

function open(m, { owner = true, readOnly = false, org = ORG } = {}) {
  orgService.getSquareMembers.mockResolvedValue(answer(m));
  render(
    <MemoryRouter>
      <ul>
        <SquareMembers org={org} owner={owner} readOnly={readOnly} />
      </ul>
    </MemoryRouter>,
  );
}
const line = async () => within(await screen.findByTestId('square-members-step'));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('before anything is added', () => {
  it('the owner presses Add members to Square, reads who changes, and Add does exactly that', async () => {
    open(members());
    let step = await line();
    expect(await step.findByText('Add your members to your Square customer list')).toBeTruthy();
    expect(step.getByText('Staff can then select them in Square Point of Sale, and their payments come to their bills here.')).toBeTruthy();
    orgService.checkSquareMembers.mockResolvedValue(answer(CHECKED));
    fireEvent.click(step.getByRole('button', { name: 'Add members to Square' }));
    expect(await screen.findByText('Check who changes, then press Add')).toBeTruthy();
    expect(orgService.checkSquareMembers).toHaveBeenCalledWith(ORG.id);
    const box = within(screen.getByTestId('square-members-check'));
    expect(box.getByText('Will be added to your Square customer list, with their name, email and phone (3):')).toBeTruthy();
    expect(within(box.getByTestId('square-members-add')).getByText('Amy Lee, Ben Ortiz and Sam Smith')).toBeTruthy();
    expect(box.getByText('Already in your Square customer list, with the same email or phone and the same name. They are linked, and nothing about them changes in Square (1):')).toBeTruthy();
    const billed = within(box.getByTestId('square-members-billed'));
    expect(billed.getByText('Square already charges this member with its own subscriptions (1):')).toBeTruthy();
    expect(billed.getByText('If you also charge their card here, they pay twice. Cancel those subscriptions in Square first.')).toBeTruthy();
    const several = within(box.getByTestId('square-members-several_customers'));
    expect(several.getByText('Left out, as Square has more than one customer who could be each of them (1):')).toBeTruthy();
    // Square's own menu words, each drawn as a label.
    for (const name of ['Customer directory', '•••', 'Merge with another customer']) expect(several.getByText(name, { selector: '.c-ui' })).toBeTruthy();
    const people = within(box.getByTestId('square-members-several_people'));
    expect(people.getByText('If they are the same person, join their records here, then check again.')).toBeTruthy();
    expect(people.getByRole('link', { name: 'Open Possible duplicates' }).getAttribute('href')).toBe('/console/iron-house/members/duplicates');

    orgService.addSquareMembers.mockResolvedValue(
      answer(members({ state: 'added', runId: RUN, automatic: true, inSquare: 4, groups: { several_customers: group(1, ['Nora Price']) } })),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Add 3 and link 1' }));
    expect(await screen.findByText('Your members are in your Square customer list')).toBeTruthy();
    expect(orgService.addSquareMembers).toHaveBeenCalledWith(ORG.id, RUN);
    step = await line();
    expect(step.getByText('4 of 5 current members are in Square. New members are added automatically.')).toBeTruthy();
    expect(step.getByText('Done')).toBeTruthy();
    // Who is still not in Square, and why, with what fixes it.
    const notIn = within(step.getByTestId('square-members-not-in'));
    expect(notIn.getByText('Not in Square:')).toBeTruthy();
    expect(within(notIn.getByTestId('square-members-several_customers')).getByText('Nora Price')).toBeTruthy();
    expect(step.getByRole('button', { name: 'Check again' })).toBeTruthy();
  });

  it('Cancel closes the check and offers the press again; nothing is added', async () => {
    open(CHECKED);
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }));
    expect(await screen.findByRole('button', { name: 'Add members to Square' })).toBeTruthy();
    expect(screen.queryByTestId('square-members-check')).toBeNull();
    expect(orgService.addSquareMembers).not.toHaveBeenCalled();
  });

  it('See all lists every name of a group, a page at a time', async () => {
    open(members({ ...CHECKED, groups: { ...CHECKED.groups, add: group(60, ['Amy Lee', 'Ben Ortiz', 'Cara Diaz']) } }));
    const add = within(await screen.findByTestId('square-members-add'));
    expect(add.getByText('Amy Lee, Ben Ortiz, Cara Diaz and 57 more')).toBeTruthy();
    const first = Array.from({ length: 50 }, (_, i) => `Person ${String(i + 1)}`);
    orgService.getSquareMembersNames.mockResolvedValueOnce({ data: { names: first, next: 50 } });
    fireEvent.click(add.getByRole('button', { name: 'See all' }));
    expect(await add.findByText('Person 50')).toBeTruthy();
    expect(orgService.getSquareMembersNames).toHaveBeenCalledWith(ORG.id, 'add', 0);
    orgService.getSquareMembersNames.mockResolvedValueOnce({ data: { names: ['Person 51'], next: null } });
    fireEvent.click(add.getByRole('button', { name: 'Show more' }));
    expect(await add.findByText('Person 51')).toBeTruthy();
    expect(orgService.getSquareMembersNames).toHaveBeenLastCalledWith(ORG.id, 'add', 50);
    expect(add.queryByRole('button', { name: 'Show more' })).toBeNull();
    fireEvent.click(add.getByRole('button', { name: 'Hide' }));
    expect(add.queryByText('Person 50')).toBeNull();
  });

  it('a check more than an hour old is checked again before anything is added', async () => {
    open(members({ ...CHECKED, expired: true }));
    expect(await screen.findByText('This check is more than an hour old.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^Add \d/ })).toBeNull();
    orgService.checkSquareMembers.mockResolvedValue(answer(members({ state: 'checking', runId: RUN, looked: 1200 })));
    fireEvent.click(screen.getByRole('button', { name: 'Check again' }));
    expect(await screen.findByText('Looked at 1,200 customers in Square so far.')).toBeTruthy();
  });

  it('a press the server refuses says why in the line', async () => {
    open(CHECKED);
    orgService.addSquareMembers.mockRejectedValue({ response: { status: 409, data: { error: 'square_members_check_changed', message: 'This check is out of date. Check again.' } } });
    fireEvent.click(await screen.findByRole('button', { name: 'Add 3 and link 1' }));
    expect((await screen.findByRole('alert')).textContent).toBe('This check is out of date. Check again.');
  });
});

describe('who may, and while Square is read', () => {
  it('anybody but the owner reads the line, with no button, and who can', async () => {
    open(members(), { owner: false, org: { ...ORG, staffRole: 'manager' } });
    expect(await screen.findByText('The owner of Iron House can add members to Square.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Add members to Square' })).toBeNull();
  });

  it("while the owner's check waits, staff read that the owner is checking", async () => {
    open(members({ ...CHECKED, groups: { add: group(3), link: group(1) } }), { owner: false });
    expect(await screen.findByText('The owner of Iron House is checking who to add to Square.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^Add/ })).toBeNull();
  });

  it("a gym whose plan has ended can't press, and is told why", async () => {
    open(members(), { readOnly: true });
    const button = await screen.findByRole('button', { name: 'Add members to Square' });
    expect(button.disabled).toBe(true);
    expect(screen.getByText(readOnlyNote('gym'))).toBeTruthy();
  });

  it('checking and adding say how far they are, and when Square is not answering', async () => {
    open(members({ state: 'checking', runId: RUN, looked: 1, unanswered: true }));
    expect(await screen.findByText('Looked at 1 customer in Square so far.')).toBeTruthy();
    expect(screen.getByText("Square isn't answering right now. The app keeps trying.")).toBeTruthy();
    cleanup();
    open(members({ state: 'adding', runId: RUN, progress: { done: 120, of: 1188 } }));
    expect(await screen.findByText('Adding members to Square…')).toBeTruthy();
    expect(screen.getByText('120 of 1,188 done.')).toBeTruthy();
  });

  it('a check Square stopped says so, and Try again checks again', async () => {
    open(members({ state: 'failed', runId: RUN, failure: 'square_unauthorized' }));
    expect(await screen.findByText("Couldn't finish checking Square")).toBeTruthy();
    expect(screen.getByText('Square no longer accepts this connection. Reconnect Square, then try again.')).toBeTruthy();
    orgService.checkSquareMembers.mockResolvedValue(answer(CHECKED));
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('Check who changes, then press Add')).toBeTruthy();
  });

  it('once added, members Square would not take and those being added are named, with what to do', async () => {
    open(members({ state: 'added', runId: RUN, automatic: true, inSquare: 3, groups: { refused: group(1, ['Una Refused']), waiting: group(1, ['Theo Park']) } }));
    const step = await line();
    expect(await step.findByText('Square didn\'t accept their details (1):')).toBeTruthy();
    expect(step.getByText('Una Refused')).toBeTruthy();
    expect(step.getByText('Check their email address and phone number on their page. The app tries again tomorrow, or when their details change.')).toBeTruthy();
    expect(step.getByText('Being added (1):')).toBeTruthy();
    expect(step.getByText('Theo Park')).toBeTruthy();
  });
});
