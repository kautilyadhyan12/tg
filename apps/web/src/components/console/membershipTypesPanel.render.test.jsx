// Settings → Memberships, as somebody who may change it sees it (spec Part 3 §13.1;
// ROADMAP 17a-i).
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

vi.mock('../../api/orgsApi', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    orgService: {
      getMembershipTypes: vi.fn(),
      createMembershipType: vi.fn(),
      updateMembershipType: vi.fn(),
      archiveMembershipType: vi.fn(),
      restoreMembershipType: vi.fn(),
    },
  };
});

const { orgService } = await import('../../api/orgsApi');
const MembershipTypesPanel = (await import('./MembershipTypesPanel')).default;
const { readOnlyNote } = await import('../../pages/console/billingView');

const ORG = { id: '11111111-1111-4111-8111-111111111111', orgType: 'gym' };
const YOGA = { id: '33333333-3333-4333-8333-000000000001', name: 'Yoga' };
const SPIN = { id: '33333333-3333-4333-8333-000000000002', name: 'Spin' };

let n = 0;
const type = (over = {}) => ({
  id: `22222222-2222-4222-8222-${String(n++).padStart(12, '0')}`,
  name: 'Gold Monthly',
  description: null,
  kind: 'recurring',
  priceMinor: 4999,
  currency: 'GBP',
  termCount: 1,
  termUnit: 'month',
  packClasses: null,
  packDays: null,
  access: 'all_classes',
  bookingsLimit: null,
  bookingsPeriod: null,
  classTypes: null,
  archivedAt: null,
  ...over,
});
const listOf = (over = {}) => ({ currency: 'GBP', types: [], archived: [], archivedTotal: 0, classChoices: [], ...over });

function open(list, { readOnly = false } = {}) {
  orgService.getMembershipTypes.mockResolvedValue({ data: list });
  render(<MembershipTypesPanel org={ORG} readOnly={readOnly} />);
  fireEvent.click(screen.getByRole('button', { name: /memberships/i }));
}

const type_ = (label, value) => fireEvent.change(screen.getByLabelText(label), { target: { value } });

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('the closed box says what is there', () => {
  it('nothing yet, then how many', async () => {
    orgService.getMembershipTypes.mockResolvedValue({ data: listOf() });
    render(<MembershipTypesPanel org={ORG} readOnly={false} />);
    expect(await screen.findByText('Nothing for sale yet')).toBeTruthy();
    cleanup();
    orgService.getMembershipTypes.mockResolvedValue({ data: listOf({ types: [type(), type({ name: 'Silver' })] }) });
    render(<MembershipTypesPanel org={ORG} readOnly={false} />);
    expect(await screen.findByText('2 membership types')).toBeTruthy();
  });

  it('a failed read opens the box and says so, never an empty list, and Try again reads again', async () => {
    orgService.getMembershipTypes
      .mockRejectedValueOnce({ response: { status: 500, data: {} } })
      .mockResolvedValueOnce({ data: listOf() });
    render(<MembershipTypesPanel org={ORG} readOnly={false} />);
    expect(await screen.findByText("We couldn't load your membership types.")).toBeTruthy();
    expect(screen.queryByText(/You haven't added anything yet/)).toBeNull();
    expect(screen.queryByText('Add a membership type')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(await screen.findByText(/You haven't added anything yet/)).toBeTruthy();
  });
});

describe('the list', () => {
  it('shows each type with its kind, its price in its own money, and what it includes', async () => {
    open(
      listOf({
        types: [
          type({ name: 'Day pass', kind: 'pack', termCount: null, termUnit: null, packClasses: 1, packDays: 1, priceMinor: 1500 }),
          type({ name: 'Gold Monthly', description: 'Small groups', access: 'limited', bookingsLimit: 8, bookingsPeriod: 'month', classTypes: [YOGA] }),
          type({ name: 'Old dollars', currency: 'USD', priceMinor: 2000 }),
        ],
      }),
    );
    expect(await screen.findByText('Prices are in GBP.', { exact: false })).toBeTruthy();
    const rows = screen.getAllByRole('listitem');
    expect(within(rows[0]).getByText('Day pass', { selector: 'span.font-semibold.text-sm' })).toBeTruthy();
    expect(within(rows[0]).getByText('£15.00 · 1 visit, on the day')).toBeTruthy();
    expect(within(rows[1]).getByText('Recurring')).toBeTruthy();
    expect(within(rows[1]).getByText('£49.99 every month')).toBeTruthy();
    expect(within(rows[1]).getByText('8 classes a month · only Yoga')).toBeTruthy();
    expect(within(rows[1]).getByText('Small groups')).toBeTruthy();
    // A type made while the gym was in another country keeps that money.
    expect(within(rows[2]).getByText('$20.00 every month')).toBeTruthy();
  });
});

describe('adding a type', () => {
  it('sends the typed price as whole minor units, once, and the list that comes back is drawn', async () => {
    const saved = type({ name: 'Gold Monthly', priceMinor: 4999 });
    orgService.createMembershipType.mockResolvedValue({ data: listOf({ types: [saved] }) });
    open(listOf());
    fireEvent.click(await screen.findByRole('button', { name: 'Add a membership type' }));
    type_('Name', '  Gold Monthly ');
    type_('Price (GBP)', '49.99');
    fireEvent.click(screen.getByRole('button', { name: 'Add membership type' }));
    await waitFor(() => expect(orgService.createMembershipType).toHaveBeenCalledTimes(1));
    expect(orgService.createMembershipType).toHaveBeenCalledWith(ORG.id, {
      name: 'Gold Monthly',
      description: null,
      kind: 'recurring',
      priceMinor: 4999,
      termCount: 1,
      termUnit: 'month',
      packClasses: null,
      packDays: null,
      access: 'all_classes',
      bookingsLimit: null,
      bookingsPeriod: null,
      classTypeIds: null,
    });
    expect(await screen.findByText('£49.99 every month')).toBeTruthy();
    // The form closes on a save.
    expect(screen.queryByLabelText('Name')).toBeNull();
  });

  it('a price that is not plainly a number is never sent, and the form says how to type one', async () => {
    open(listOf());
    fireEvent.click(await screen.findByRole('button', { name: 'Add a membership type' }));
    type_('Name', 'Gold');
    for (const typed of ['49,99', '£49.99', '']) {
      type_('Price (GBP)', typed);
      fireEvent.click(screen.getByRole('button', { name: 'Add membership type' }));
      expect(screen.getByText('Type the price as a number, like 49.99. Type 0 for free.')).toBeTruthy();
      // Beside the button too, and the wrong box takes the keyboard: the sentence under
      // it may be off the screen on a long form.
      expect(screen.getByRole('alert').textContent).toBe('Not saved yet. Fix what is marked in red above.');
      expect(document.activeElement).toBe(screen.getByLabelText('Price (GBP)'));
    }
    // Typing does not pull the keyboard back, and a right price clears both sentences.
    screen.getByLabelText('Name').focus();
    type_('Name', 'Gold Monthly');
    expect(document.activeElement).toBe(screen.getByLabelText('Name'));
    type_('Price (GBP)', '49.99');
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByText(/Type the price as a number/)).toBeNull();
    expect(orgService.createMembershipType).not.toHaveBeenCalled();
  });

  it('shows the boxes its kind needs: a pack its classes and days, a day pass neither', async () => {
    orgService.createMembershipType.mockResolvedValue({ data: listOf() });
    open(listOf({ classChoices: [SPIN, YOGA] }));
    fireEvent.click(await screen.findByRole('button', { name: 'Add a membership type' }));
    expect(screen.getByLabelText('Charged every')).toBeTruthy();
    expect(screen.getByLabelText('Classes')).toBeTruthy();
    expect(within(screen.getByRole('radiogroup', { name: 'How is it paid?' })).getAllByRole('radio')).toHaveLength(5);

    fireEvent.click(screen.getByRole('radio', { name: /^Class pack/ }));
    expect(screen.getByLabelText('Classes in the pack')).toBeTruthy();
    expect(screen.getByLabelText('Days to use them in')).toBeTruthy();
    expect(screen.queryByLabelText('Charged every')).toBeNull();
    expect(screen.queryByLabelText('Classes')).toBeNull();

    fireEvent.click(screen.getByRole('radio', { name: /^Day pass/ }));
    expect(screen.queryByLabelText('Classes in the pack')).toBeNull();
    type_('Name', 'Day pass');
    type_('Price (GBP)', '15');
    type_('Which classes', 'some');
    fireEvent.click(screen.getByRole('button', { name: 'Add membership type' }));
    expect(screen.getByText('Tick at least one class, or choose Every class.')).toBeTruthy();
    fireEvent.click(screen.getByLabelText('Yoga'));
    fireEvent.click(screen.getByRole('button', { name: 'Add membership type' }));
    await waitFor(() => expect(orgService.createMembershipType).toHaveBeenCalledTimes(1));
    expect(orgService.createMembershipType.mock.calls[0][1]).toMatchObject({
      name: 'Day pass',
      kind: 'pack',
      priceMinor: 1500,
      packClasses: 1,
      packDays: 1,
      termCount: null,
      classTypeIds: [YOGA.id],
    });
  });

  it("says the server's own reason when it refuses, and keeps what was typed", async () => {
    orgService.createMembershipType.mockRejectedValue({
      response: { status: 409, data: { error: 'membership_type_name_taken', message: 'You already have a membership type with this name. Pick another name.' } },
    });
    open(listOf());
    fireEvent.click(await screen.findByRole('button', { name: 'Add a membership type' }));
    type_('Name', 'Gold');
    type_('Price (GBP)', '49.99');
    fireEvent.click(screen.getByRole('button', { name: 'Add membership type' }));
    expect((await screen.findByRole('alert')).textContent).toBe('You already have a membership type with this name. Pick another name.');
    expect(screen.getByLabelText('Name').value).toBe('Gold');
    expect(screen.getByLabelText('Price (GBP)').value).toBe('49.99');
  });

  it('a gym with no country is told to set it, and is offered no form', async () => {
    open(listOf({ currency: null }));
    expect(await screen.findByText(/Set your country in your details/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Add a membership type' })).toBeNull();
  });

  it('a full list says so instead of offering Add', async () => {
    open(listOf({ types: Array.from({ length: 60 }, (_, i) => type({ name: `Type ${String(i)}` })) }));
    expect(await screen.findByText('You can have 60 membership types. Archive one you no longer sell first.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Add a membership type' })).toBeNull();
  });
});

describe('the gym\x27s own options', () => {
  it('sends its description and a class limit counted by the week or the month', async () => {
    orgService.createMembershipType.mockResolvedValue({ data: listOf() });
    open(listOf());
    fireEvent.click(await screen.findByRole('button', { name: 'Add a membership type' }));
    type_('Name', 'Twice a week');
    type_('Description (optional)', ' Two classes a week, any time ');
    type_('Price (GBP)', '35');
    type_('Classes', 'limited');
    type_('How many classes', '2');
    type_('How many classes: a week or a month', 'week');
    fireEvent.click(screen.getByRole('button', { name: 'Add membership type' }));
    await waitFor(() => expect(orgService.createMembershipType).toHaveBeenCalledTimes(1));
    expect(orgService.createMembershipType.mock.calls[0][1]).toMatchObject({
      name: 'Twice a week',
      description: 'Two classes a week, any time',
      kind: 'recurring',
      priceMinor: 3500,
      access: 'limited',
      bookingsLimit: 2,
      bookingsPeriod: 'week',
    });
  });

  it('an empty list says how a gym starts, in its own words', async () => {
    open(listOf());
    expect(await screen.findByText(/Add each thing you sell, with your own name and price/)).toBeTruthy();
  });
});

describe('changing, archiving and putting back', () => {
  it('opens a type as it was saved, its kind fixed, and saves in the money it was made in', async () => {
    const gold = type({ name: 'Gold Monthly', currency: 'USD', priceMinor: 4999, termCount: 3 });
    orgService.updateMembershipType.mockResolvedValue({ data: listOf({ types: [{ ...gold, priceMinor: 5500 }] }) });
    open(listOf({ types: [gold] }));
    fireEvent.click(await screen.findByRole('button', { name: 'Change Gold Monthly' }));
    expect(screen.getByLabelText('Name').value).toBe('Gold Monthly');
    expect(screen.getByLabelText('Price (USD)').value).toBe('49.99');
    expect(screen.getByLabelText('Charged every').value).toBe('3');
    for (const radio of screen.getAllByRole('radio')) expect(radio.disabled).toBe(true);
    expect(screen.getByRole('radio', { name: /^Recurring/ }).checked).toBe(true);
    expect(screen.getByText(/How it is paid can't be changed once it is saved/)).toBeTruthy();

    type_('Price (USD)', '55');
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(orgService.updateMembershipType).toHaveBeenCalledTimes(1));
    expect(orgService.updateMembershipType.mock.calls[0][1]).toBe(gold.id);
    expect(orgService.updateMembershipType.mock.calls[0][2]).toMatchObject({ kind: 'recurring', priceMinor: 5500, termCount: 3 });
    expect(await screen.findByText('$55.00 every 3 months')).toBeTruthy();
  });

  it('Cancel changes nothing', async () => {
    const gold = type();
    open(listOf({ types: [gold] }));
    fireEvent.click(await screen.findByRole('button', { name: 'Change Gold Monthly' }));
    type_('Price (GBP)', '1');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByLabelText('Name')).toBeNull();
    expect(orgService.updateMembershipType).not.toHaveBeenCalled();
    expect(screen.getByText('£49.99 every month')).toBeTruthy();
  });

  it('archives only after asking, and says nothing is deleted', async () => {
    const gold = type();
    orgService.archiveMembershipType.mockResolvedValue({ data: listOf({ archived: [{ ...gold, archivedAt: '2026-10-04T10:00:00.000Z' }], archivedTotal: 1 }) });
    open(listOf({ types: [gold] }));
    fireEvent.click(await screen.findByRole('button', { name: 'Archive Gold Monthly' }));
    expect(screen.getByText('Archive Gold Monthly? It leaves your list of what you sell. Nothing is deleted, and you can put it back.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Keep it' }));
    expect(orgService.archiveMembershipType).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Archive Gold Monthly' }));
    fireEvent.click(screen.getByRole('button', { name: 'Archive' }));
    await waitFor(() => expect(orgService.archiveMembershipType).toHaveBeenCalledWith(ORG.id, gold.id));
    expect(await screen.findByRole('button', { name: 'Show archived (1)' })).toBeTruthy();
  });

  it('puts an archived type back from the archived list', async () => {
    const gold = type({ archivedAt: '2026-10-04T10:00:00.000Z' });
    orgService.restoreMembershipType.mockResolvedValue({ data: listOf({ types: [{ ...gold, archivedAt: null }] }) });
    open(listOf({ archived: [gold], archivedTotal: 3 }));
    fireEvent.click(await screen.findByRole('button', { name: 'Show archived (3)' }));
    expect(screen.getByText('Showing the newest 1 of 3.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Put back Gold Monthly' }));
    await waitFor(() => expect(orgService.restoreMembershipType).toHaveBeenCalledWith(ORG.id, gold.id));
    expect(await screen.findByRole('button', { name: 'Change Gold Monthly' })).toBeTruthy();
  });
});

describe('a gym with no live plan', () => {
  it('still sees its list, says why nothing can be changed, and its buttons are off', async () => {
    const gold = type({ archivedAt: null });
    open(listOf({ types: [gold], archived: [type({ name: 'Old', archivedAt: '2026-10-04T10:00:00.000Z' })], archivedTotal: 1 }), { readOnly: true });
    expect(await screen.findByText('£49.99 every month')).toBeTruthy();
    expect(screen.getByText(readOnlyNote('gym'))).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Add a membership type' }).disabled).toBe(true);
    expect(screen.getByRole('button', { name: 'Change Gold Monthly' }).disabled).toBe(true);
    expect(screen.getByRole('button', { name: 'Archive Gold Monthly' }).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Show archived (1)' }));
    expect(screen.getByRole('button', { name: 'Put back Old' }).disabled).toBe(true);
  });
});
