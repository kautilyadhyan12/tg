// The Memberships page, as somebody who may change it sees it (spec Part 3 §13.1;
// ROADMAP 17a-i; a page of its own, drawn open, since 23c-i).
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('../../api/orgsApi', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    orgService: {
      getMembershipTypes: vi.fn(),
      // The Bills card under the price list has its own tests (`memberBills.render.test.jsx`).
      getBillSettings: vi.fn(() => new Promise(() => undefined)),
      createMembershipType: vi.fn(),
      updateMembershipType: vi.fn(),
      archiveMembershipType: vi.fn(),
      restoreMembershipType: vi.fn(),
      previewRenewalReminder: vi.fn(),
      previewPriceRaise: vi.fn(() => Promise.resolve({ data: { currency: 'GBP', people: [] } })),
      // The list's own words (17a-iii) have their own test: none here.
      getMembershipWords: vi.fn(() => Promise.resolve({ data: { words: [], types: [] } })),
      // The Payments box, for Sell in the app (18k-i): not answered unless a test says, so nothing is said of Square.
      getGymPayments: vi.fn(() => new Promise(() => undefined)),
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
  updatedAt: '2026-10-04T09:00:00.000Z',
  ...over,
});
const listOf = (over = {}) => ({ currency: 'GBP', types: [], archived: [], archivedTotal: 0, classChoices: [], ...over });

function open(list, { readOnly = false, org = ORG } = {}) {
  orgService.getMembershipTypes.mockResolvedValue({ data: list });
  render(<MembershipTypesPanel org={org} readOnly={readOnly} />);
}

const type_ = (label, value) => fireEvent.change(screen.getByLabelText(label), { target: { value } });

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('the list says what is there', () => {
  it('nothing yet, then how many', async () => {
    orgService.getMembershipTypes.mockResolvedValue({ data: listOf() });
    render(<MembershipTypesPanel org={ORG} readOnly={false} />);
    expect(await screen.findByText('Nothing for sale yet')).toBeTruthy();
    cleanup();
    orgService.getMembershipTypes.mockResolvedValue({ data: listOf({ types: [type(), type({ name: 'Silver' })] }) });
    render(<MembershipTypesPanel org={ORG} readOnly={false} />);
    expect(await screen.findByText('2 membership types')).toBeTruthy();
  });

  it('a failed read says so, never an empty list, and Try again reads again', async () => {
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
    expect(await screen.findByText('New prices are in GBP.', { exact: false })).toBeTruthy();
    const rows = screen.getAllByRole('listitem');
    expect(within(rows[0]).getByText('Day pass', { selector: 'span.c-w6' })).toBeTruthy();
    expect(within(rows[0]).getByText('£15.00 · 1 visit, on the day')).toBeTruthy();
    expect(within(rows[1]).getByText('Recurring')).toBeTruthy();
    expect(within(rows[1]).getByText('£49.99 every month')).toBeTruthy();
    expect(within(rows[1]).getByText('8 classes a month · only Yoga')).toBeTruthy();
    expect(within(rows[1]).getByText('Small groups')).toBeTruthy();
    // A type made while the gym was in another country keeps that money.
    expect(within(rows[2]).getByText('$20.00 every month')).toBeTruthy();
  });
});

describe('which agreement each line is signed with (18u-ii-a)', () => {
  const PACK_TERMS = { id: '55555555-5555-4555-8555-000000000001', name: 'Class pack terms' };
  it('says nothing where the business has only its main agreement', async () => {
    open(listOf({ types: [type({ name: 'Gold Monthly' })] }));
    await screen.findByText('Gold Monthly', { selector: 'span.c-w6' });
    expect(screen.queryByText(/^Agreement: /)).toBeNull();
  });

  it("names each line's agreement once there are others, and Open agreement opens that one in Settings", async () => {
    orgService.getMembershipTypes.mockResolvedValue({
      data: listOf({ types: [type({ name: '10-class pack', agreementId: PACK_TERMS.id }), type({ name: 'Gold Monthly' })], agreements: [PACK_TERMS], defaultAgreement: 'in_use' }),
    });
    render(
      <MemoryRouter>
        <MembershipTypesPanel org={{ ...ORG, slug: 'iron-house', staffRole: 'owner' }} readOnly={false} />
      </MemoryRouter>,
    );
    const rows = await screen.findAllByRole('listitem');
    expect(within(rows[0]).getByText('Agreement: Class pack terms')).toBeTruthy();
    expect(within(rows[1]).getByText('Agreement: Default agreement')).toBeTruthy();
    expect(within(rows[0]).getByRole('link', { name: 'Open the agreement for 10-class pack' }).getAttribute('href')).toBe(`/console/iron-house/settings#agreement-${PACK_TERMS.id}`);
    expect(within(rows[1]).getByRole('link', { name: 'Open the agreement for Gold Monthly' }).getAttribute('href')).toBe('/console/iron-house/settings#membership-agreement');
  });

  it('staff who cannot change Settings read the line with no button', async () => {
    orgService.getMembershipTypes.mockResolvedValue({ data: listOf({ types: [type({ name: '10-class pack', agreementId: PACK_TERMS.id })], agreements: [PACK_TERMS] }) });
    render(
      <MemoryRouter>
        <MembershipTypesPanel org={{ ...ORG, slug: 'iron-house', privileges: ['memberships.manage'] }} readOnly={false} />
      </MemoryRouter>,
    );
    expect(await screen.findByText('Agreement: Class pack terms')).toBeTruthy();
    expect(screen.queryByRole('link', { name: /Open the agreement/ })).toBeNull();
  });
});

describe('adding a type', () => {
  it('a notice to cancel (18v-ii-a): typed in days, said under the box, sent with the type and shown on its row', async () => {
    orgService.createMembershipType.mockResolvedValue({ data: listOf({ types: [type({ name: 'Gold Monthly', noticeDays: 30 })] }) });
    open(listOf());
    fireEvent.click(await screen.findByRole('button', { name: 'Add a membership type' }));
    type_('Name', 'Gold Monthly');
    type_('Price (GBP)', '49.99');
    expect(screen.getByText('Leave empty for no notice: members can stop at the end of what they have paid.')).toBeTruthy();
    type_('Notice to cancel', '30');
    expect(screen.getByText("Members who cancel give 30 days' notice: they stay, and pay, to the end of the payment period it ends in.")).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Add membership type' }));
    await waitFor(() => expect(orgService.createMembershipType).toHaveBeenCalledTimes(1));
    expect(orgService.createMembershipType.mock.calls[0][1]).toMatchObject({ kind: 'recurring', noticeDays: 30 });
    expect(await screen.findByText('Notice to cancel: 30 days')).toBeTruthy();
  });

  it('a cooling-off period (18v-iii): typed in days on any kind, said under the box, refused on a free line, and shown on its row', async () => {
    orgService.createMembershipType.mockResolvedValue({ data: listOf({ types: [type({ name: 'Gold Monthly', coolingOffDays: 3 })] }) });
    open(listOf());
    fireEvent.click(await screen.findByRole('button', { name: 'Add a membership type' }));
    type_('Name', 'Gold Monthly');
    type_('Price (GBP)', '0');
    expect(screen.getByText('Days after they sign in which members can cancel with a full refund. Weekends count. Leave empty for none.')).toBeTruthy();
    type_('Cooling-off period', '3');
    expect(screen.getByText('For 3 days after they sign, members can cancel with a full refund. Weekends count.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Add membership type' }));
    expect(await screen.findByText('A free membership has no cooling-off period. Leave it empty.')).toBeTruthy();
    expect(orgService.createMembershipType).not.toHaveBeenCalled();
    type_('Price (GBP)', '49.99');
    fireEvent.click(screen.getByRole('button', { name: 'Add membership type' }));
    await waitFor(() => expect(orgService.createMembershipType).toHaveBeenCalledTimes(1));
    expect(orgService.createMembershipType.mock.calls[0][1]).toMatchObject({ kind: 'recurring', priceMinor: 4999, coolingOffDays: 3 });
    expect(await screen.findByText('Cooling-off period: 3 days')).toBeTruthy();
  });

  it('a contract (18v-i): its boxes appear when chosen, say how long it runs, and are sent with the type', async () => {
    orgService.createMembershipType.mockResolvedValue({ data: listOf({ types: [type({ name: 'Gold 12 months', contractPeriods: 12, contractThen: 'ends' })] }) });
    open(listOf());
    fireEvent.click(await screen.findByRole('button', { name: 'Add a membership type' }));
    type_('Name', 'Gold 12 months');
    type_('Price (GBP)', '49.99');
    expect(screen.getByText('Members can cancel at any time.')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Minimum term'), { target: { value: 'fixed' } });
    fireEvent.change(screen.getByLabelText('After the minimum term'), { target: { value: 'ends' } });
    expect(screen.getByText('They stay 12 months, then it ends.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Add membership type' }));
    await waitFor(() => expect(orgService.createMembershipType).toHaveBeenCalledTimes(1));
    expect(orgService.createMembershipType.mock.calls[0][1]).toMatchObject({ kind: 'recurring', contractPeriods: 12, contractThen: 'ends' });
    expect(await screen.findByText('Minimum term: 12 months, then it ends')).toBeTruthy();
  });

  it('an early cancellation fee (18v-ii-b): its box comes with a minimum term only, is sent in minor units, and shows on its row', async () => {
    orgService.createMembershipType.mockResolvedValue({ data: listOf({ types: [type({ name: 'Gold 12 months', contractPeriods: 12, contractThen: 'renews', leaveFeeMinor: 9900 })] }) });
    open(listOf());
    fireEvent.click(await screen.findByRole('button', { name: 'Add a membership type' }));
    type_('Name', 'Gold 12 months');
    type_('Price (GBP)', '49.99');
    expect(screen.queryByLabelText('Early cancellation fee (GBP)')).toBeNull();
    fireEvent.change(screen.getByLabelText('Minimum term'), { target: { value: 'fixed' } });
    expect(
      screen.getByText('Added once to the bills of a member you cancel early, inside the minimum term. Members you release for a reason, such as moving away, pay none. Leave it empty for none.'),
    ).toBeTruthy();
    type_('Early cancellation fee (GBP)', '0');
    fireEvent.click(screen.getByRole('button', { name: 'Add membership type' }));
    expect(await screen.findByText('Type the early cancellation fee as a number, like 25.00, or leave it empty.')).toBeTruthy();
    expect(orgService.createMembershipType).not.toHaveBeenCalled();
    type_('Early cancellation fee (GBP)', '99');
    fireEvent.click(screen.getByRole('button', { name: 'Add membership type' }));
    await waitFor(() => expect(orgService.createMembershipType).toHaveBeenCalledTimes(1));
    expect(orgService.createMembershipType.mock.calls[0][1]).toMatchObject({ contractPeriods: 12, contractThen: 'renews', leaveFeeMinor: 9900 });
    expect(await screen.findByText('Early cancellation fee: £99.00')).toBeTruthy();
  });

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
      includesPt: false,
      ptLimit: null,
      ptPeriod: null,
      taxRateIds: [],
      joiningFeeMinor: 0,
      contractPeriods: null,
      contractThen: null,
      leaveFeeMinor: null,
      noticeDays: null,
      coolingOffDays: null,
      renewalReminderDays: null, termReminderDays: null,
      soldInApp: false,
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
    // Somebody who may not change the gym's details is told who can, and given no button.
    expect(await screen.findByText(/A membership type can't be added until your country is set\. Ask the owner to set it in Gym details\./)).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Open Settings' })).toBeNull();
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

describe('a limit on personal training sessions', () => {
  it('is offered once the type includes personal training, and is sent as typed', async () => {
    open(listOf());
    fireEvent.click(await screen.findByRole('button', { name: 'Add a membership type' }));
    type_('Name', 'Gold');
    type_('Price (GBP)', '99');
    // Nothing about a limit until the type includes personal training.
    expect(screen.queryByLabelText('Personal training sessions')).toBeNull();
    fireEvent.click(screen.getByRole('checkbox', { name: /Includes personal training/ }));
    expect(screen.getByLabelText('Personal training sessions').value).toBe('none');
    expect(screen.queryByLabelText('How many sessions')).toBeNull();
    type_('Personal training sessions', 'limited');
    expect(screen.getByLabelText('How many sessions').value).toBe('4');
    expect(screen.getByText(/A week is Monday to Sunday; a month is the calendar month\./)).toBeTruthy();

    // Not a number: nothing is sent, and the box says how.
    type_('How many sessions', 'four');
    fireEvent.click(screen.getByRole('button', { name: 'Add membership type' }));
    expect(await screen.findByText('Type how many sessions, from 1 to 200.')).toBeTruthy();
    expect(orgService.createMembershipType).not.toHaveBeenCalled();

    type_('How many sessions', '2');
    fireEvent.change(screen.getByLabelText('How many sessions: a week or a month'), { target: { value: 'week' } });
    orgService.createMembershipType.mockResolvedValue({ data: listOf({ types: [type({ name: 'Gold', includesPt: true, ptLimit: 2, ptPeriod: 'week' })] }) });
    fireEvent.click(screen.getByRole('button', { name: 'Add membership type' }));
    await waitFor(() => expect(orgService.createMembershipType).toHaveBeenCalledTimes(1));
    expect(orgService.createMembershipType.mock.calls[0][1]).toMatchObject({ includesPt: true, ptLimit: 2, ptPeriod: 'week' });
    // The list that comes back says the limit on the type's own line.
    expect(await screen.findByText(/2 personal training sessions a week/)).toBeTruthy();
  });

  it("a Pilates studio's form names its instructors (5f-ii)", async () => {
    open(listOf(), { org: { ...ORG, orgType: 'pilates_studio' } });
    fireEvent.click(await screen.findByRole('button', { name: 'Add a membership type' }));
    expect(screen.getByText('Sessions with an instructor can be booked on this membership.')).toBeTruthy();
    fireEvent.click(screen.getByRole('radio', { name: /^Class pack/ }));
    expect(screen.getByText('Each session booked with an instructor uses one from the pack.')).toBeTruthy();
  });

  it("a Pilates studio's list and form say open studio, never gym (5f-iii)", async () => {
    open(
      listOf({
        types: [
          type({ name: 'Open practice', access: 'gym_only' }),
          type({ name: 'Day pass', kind: 'pack', termCount: null, termUnit: null, packClasses: 1, packDays: 1, priceMinor: 1500 }),
        ],
      }),
      { org: { ...ORG, orgType: 'pilates_studio' } },
    );
    const rows = await screen.findAllByRole('listitem');
    expect(within(rows[0]).getByText('No classes, open studio only')).toBeTruthy();
    expect(within(rows[1]).getByText('Open studio or any class')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Add a membership type' }));
    expect(screen.getByLabelText('Description (optional)').getAttribute('placeholder')).toBe('For example: All classes and open studio');
    expect(screen.getByRole('option', { name: 'No classes, open studio only' })).toBeTruthy();
    expect(screen.getByText('Charged every week, month or year until it is cancelled.')).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/\bgym\b/i);
  });

  it('a pack is offered no limit: each session uses one from the pack', async () => {
    open(listOf());
    fireEvent.click(await screen.findByRole('button', { name: 'Add a membership type' }));
    fireEvent.click(screen.getByRole('radio', { name: /^Class pack/ }));
    fireEvent.click(screen.getByRole('checkbox', { name: /Includes personal training/ }));
    expect(screen.queryByLabelText('Personal training sessions')).toBeNull();
  });
});

describe('a renewal reminder (18v-iv)', () => {
  it('names who would be emailed, and when, before it is saved; sends it with the line and shows it on its row', async () => {
    const gold = type({ name: 'Gold Yearly', termUnit: 'year', priceMinor: 49900 });
    orgService.previewRenewalReminder.mockResolvedValue({
      data: {
        people: [
          { entryId: '44444444-4444-4444-8444-000000000001', name: 'Ana Ruiz', paidBy: null, status: { state: 'will_send', on: '2026-11-07', aboutOn: '2026-12-07' } },
          { entryId: '44444444-4444-4444-8444-000000000002', name: 'Nell Phone', paidBy: null, status: { state: 'no_email', on: null, aboutOn: '2026-12-07' } },
        ],
      },
    });
    orgService.updateMembershipType.mockResolvedValue({ data: listOf({ types: [{ ...gold, renewalReminderDays: 30 }] }) });
    open(listOf({ types: [gold] }));
    fireEvent.click(await screen.findByRole('button', { name: 'Change Gold Yearly' }));
    // No minimum term: only before every renewal is offered.
    expect(screen.queryByLabelText('Reminder before the minimum term ends')).toBeNull();
    type_('Reminder before every renewal', '30');
    const box = await screen.findByTestId('reminder-box-every_renewal');
    expect(within(box).getByText('Will be emailed (1)')).toBeTruthy();
    expect(within(box).getByText('Ana Ruiz · to be emailed 7 Nov · renews 7 Dec')).toBeTruthy();
    expect(within(box).getByText('Not emailed: no email address on the record of whoever pays (1)')).toBeTruthy();
    expect(orgService.previewRenewalReminder).toHaveBeenLastCalledWith(ORG.id, gold.id, { when: 'every_renewal', days: 30 });
    expect(orgService.updateMembershipType).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(orgService.updateMembershipType).toHaveBeenCalledTimes(1));
    expect(orgService.updateMembershipType.mock.calls[0][2]).toMatchObject({ renewalReminderDays: 30, termReminderDays: null });
    expect(await screen.findByText('Renewal reminder: 30 days before every renewal')).toBeTruthy();
  });

  it('with a minimum term, both: each its own pick and its own box, sent together', async () => {
    const gold = type({ name: 'Gold Term', contractPeriods: 12, contractThen: 'renews' });
    orgService.previewRenewalReminder.mockImplementation((_g, _t, setting) =>
      Promise.resolve({
        data: { people: [{ entryId: '44444444-4444-4444-8444-000000000001', name: 'Ana Ruiz', paidBy: null, status: { state: 'will_send', on: setting.when === 'term_end' ? '2027-10-04' : '2026-11-27', aboutOn: setting.when === 'term_end' ? '2027-11-02' : '2026-12-03' } }] },
      }),
    );
    orgService.updateMembershipType.mockResolvedValue({ data: listOf({ types: [{ ...gold, renewalReminderDays: 7, termReminderDays: 30 }] }) });
    open(listOf({ types: [gold] }));
    fireEvent.click(await screen.findByRole('button', { name: 'Change Gold Term' }));
    type_('Reminder before every renewal', '7');
    type_('Reminder before the minimum term ends', '30');
    expect(within(await screen.findByTestId('reminder-box-every_renewal')).getByText('Ana Ruiz · to be emailed 27 Nov · renews 3 Dec')).toBeTruthy();
    expect(within(await screen.findByTestId('reminder-box-term_end')).getByText('Ana Ruiz · to be emailed 4 Oct · term ends 2 Nov')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(orgService.updateMembershipType).toHaveBeenCalledTimes(1));
    expect(orgService.updateMembershipType.mock.calls[0][2]).toMatchObject({ renewalReminderDays: 7, termReminderDays: 30 });
    expect(await screen.findByText('Minimum term reminder: 30 days before it ends')).toBeTruthy();
  });
});

describe('a higher price for members already on it (18w)', () => {
  const ANA = '66666666-6666-4666-8666-000000000001';
  const BEN = '66666666-6666-4666-8666-000000000002';
  const NELL = '66666666-6666-4666-8666-000000000003';
  const status = (state, over = {}) => ({ state, fromMinor: 4999, toMinor: 5499, startsOn: '2026-12-03', on: '2026-11-03', ...over });
  const person = (membershipId, name, s) => ({ membershipId, entryId: membershipId.replace('6666-4666', '7777-4777'), name, paidBy: null, status: s });
  const offer = {
    currency: 'GBP',
    people: [
      person(ANA, 'Ana Ruiz', status('will_send')),
      person(BEN, 'Ben Okafor', status('will_send')),
      person(NELL, 'Nell Phone', status('no_email', { toMinor: 4999, startsOn: null, on: null })),
    ],
  };
  afterEach(() => orgService.previewPriceRaise.mockImplementation(() => Promise.resolve({ data: { currency: 'GBP', people: [] } })));

  it('asks what the members already on it pay, names who goes up and who won\'t, and sends only those ticked', async () => {
    const gold = type({ name: 'Gold Monthly', priceMinor: 4999 });
    orgService.previewPriceRaise.mockResolvedValue({ data: offer });
    orgService.updateMembershipType.mockResolvedValue({ data: { ...listOf({ types: [{ ...gold, priceMinor: 5499 }] }), raised: 1 } });
    open(listOf({ types: [gold] }));
    fireEvent.click(await screen.findByRole('button', { name: 'Change Gold Monthly' }));
    // A lower price asks nothing.
    type_('Price (GBP)', '45.00');
    expect(screen.queryByTestId('raise-field')).toBeNull();
    type_('Price (GBP)', '54.99');
    const field = await screen.findByTestId('raise-field');
    expect(orgService.previewPriceRaise).toHaveBeenLastCalledWith(ORG.id, gold.id, { priceMinor: 5499, noticeDays: 30 });
    expect(within(field).getByText('They go on paying £49.99. Only members who join from now on pay the new price.')).toBeTruthy();

    // Nothing chosen: Save is refused with the reason under the question, and nothing is sent.
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(await within(field).findByText('Choose what the members already on it pay.')).toBeTruthy();
    expect(orgService.updateMembershipType).not.toHaveBeenCalled();

    fireEvent.click(within(field).getByRole('radio', { name: /^Move them to the new price/ }));
    const box = await screen.findByTestId('raise-box');
    expect(within(box).getByText('Pays the new price (2)')).toBeTruthy();
    expect(within(box).getByText("Won't change: no email address to send the notice to (1)")).toBeTruthy();
    expect(within(box).getByText('Nell Phone')).toBeTruthy();
    const ben = within(box).getByRole('checkbox', { name: 'Ben Okafor · £49.99 to £54.99 from 3 Dec · emailed 3 Nov' });
    expect(ben.checked).toBe(true);
    fireEvent.click(ben);
    expect(ben.checked).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(orgService.updateMembershipType).toHaveBeenCalledTimes(1));
    expect(orgService.updateMembershipType.mock.calls[0][2]).toMatchObject({ priceMinor: 5499, raise: { noticeDays: 30, membershipIds: [ANA] } });
    // Said in the line's own row.
    expect(await screen.findByText('Saved. 1 member pays the new price from their first payment at least 30 days away, and each is emailed 30 days before it.')).toBeTruthy();
  });

  it('a shorter notice asks again; Keep their price sends no raise; nobody on it asks nothing', async () => {
    const gold = type({ name: 'Gold Monthly', priceMinor: 4999 });
    orgService.previewPriceRaise.mockResolvedValue({ data: offer });
    orgService.updateMembershipType.mockResolvedValue({ data: listOf({ types: [{ ...gold, priceMinor: 5499 }] }) });
    open(listOf({ types: [gold] }));
    fireEvent.click(await screen.findByRole('button', { name: 'Change Gold Monthly' }));
    type_('Price (GBP)', '54.99');
    const field = await screen.findByTestId('raise-field');
    fireEvent.click(within(field).getByRole('radio', { name: /^Move them to the new price/ }));
    type_('Email them', '7');
    await waitFor(() => expect(orgService.previewPriceRaise).toHaveBeenLastCalledWith(ORG.id, gold.id, { priceMinor: 5499, noticeDays: 7 }));
    fireEvent.click(within(field).getByRole('radio', { name: /^Keep their price/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(orgService.updateMembershipType).toHaveBeenCalledTimes(1));
    expect(orgService.updateMembershipType.mock.calls[0][2].raise).toBeUndefined();
    cleanup();

    orgService.previewPriceRaise.mockResolvedValue({ data: { currency: 'GBP', people: [] } });
    open(listOf({ types: [gold] }));
    fireEvent.click(await screen.findByRole('button', { name: 'Change Gold Monthly' }));
    type_('Price (GBP)', '54.99');
    await waitFor(() => expect(orgService.previewPriceRaise).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(screen.queryByTestId('raise-field')).toBeNull();
  });
});

describe('changing, archiving and putting back', () => {
  it('opens a type as it was saved, its kind fixed, and saves in the money it was made in', async () => {
    // Yen in a pound gym: 4999 yen is typed "4999" and 55 yen is 55, where a form that
    // took the gym's pounds would show 49.99 and send 5500.
    const gold = type({ name: 'Gold Monthly', currency: 'JPY', priceMinor: 4999, termCount: 3 });
    orgService.updateMembershipType.mockResolvedValue({ data: listOf({ types: [{ ...gold, priceMinor: 55 }] }) });
    open(listOf({ types: [gold] }));
    fireEvent.click(await screen.findByRole('button', { name: 'Change Gold Monthly' }));
    expect(screen.getByLabelText('Name').value).toBe('Gold Monthly');
    expect(screen.getByLabelText('Price (JPY)').value).toBe('4999');
    expect(screen.getByLabelText('Charged every').value).toBe('3');
    for (const radio of screen.getAllByRole('radio')) expect(radio.disabled).toBe(true);
    expect(screen.getByRole('radio', { name: /^Recurring/ }).checked).toBe(true);
    expect(screen.getByText(/How it is paid can't be changed once it is saved/)).toBeTruthy();

    type_('Price (JPY)', '55');
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(orgService.updateMembershipType).toHaveBeenCalledTimes(1));
    expect(orgService.updateMembershipType.mock.calls[0][1]).toBe(gold.id);
    expect(orgService.updateMembershipType.mock.calls[0][2]).toMatchObject({
      kind: 'recurring',
      priceMinor: 55,
      termCount: 3,
      updatedAt: '2026-10-04T09:00:00.000Z',
    });
    expect(await screen.findByText('¥55 every 3 months')).toBeTruthy();
  });

  it('a type somebody else changed meanwhile is not saved over: the list is read again and the reason said', async () => {
    const gold = type();
    orgService.updateMembershipType.mockRejectedValue({
      response: { status: 409, data: { error: 'membership_type_changed', message: 'Somebody changed this membership type while you had it open. Nothing was saved: check it and try again.' } },
    });
    open(listOf({ types: [gold] }));
    fireEvent.click(await screen.findByRole('button', { name: 'Change Gold Monthly' }));
    orgService.getMembershipTypes.mockResolvedValue({ data: listOf({ types: [{ ...gold, priceMinor: 6000, updatedAt: '2026-10-04T09:30:00.000Z' }] }) });
    type_('Name', 'Gold Plus');
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/Somebody changed this membership type/);
    expect(await screen.findByText('£60.00 every month')).toBeTruthy();
    expect(screen.queryByLabelText('Name')).toBeNull();
  });

  it('while a form is open, the rows cannot be changed or archived, so nothing typed is thrown away', async () => {
    open(listOf({ types: [type(), type({ name: 'Silver' })] }));
    fireEvent.click(await screen.findByRole('button', { name: 'Change Gold Monthly' }));
    type_('Price (GBP)', '60');
    for (const name of ['Change Silver', 'Archive Silver', 'Change Gold Monthly', 'Archive Gold Monthly']) {
      expect(screen.getByRole('button', { name }).disabled, name).toBe(true);
    }
    fireEvent.click(screen.getByRole('button', { name: 'Change Silver' }));
    expect(screen.getByLabelText('Price (GBP)').value).toBe('60');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByRole('button', { name: 'Change Silver' }).disabled).toBe(false);
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

// 23c-i: the page is open from top to bottom, so a form opens where it was asked for.
describe('where the form opens', () => {
  const rowOf = (name) => screen.getByRole('button', { name: `Change ${name}` }).closest('li');

  it('a new type: under the title, above the list, and the Add button makes way for it', async () => {
    open(listOf({ types: [type()] }));
    fireEvent.click(await screen.findByRole('button', { name: 'Add a membership type' }));
    const form = screen.getByRole('form', { name: 'Add a membership type' });
    // While there is still a choice to make, the form says it is made once.
    expect(
      within(form).getByText("How it is paid can't be changed once it is saved. To sell it another way later, archive this one and add a new one."),
    ).toBeTruthy();
    const list = screen.getByRole('region', { name: 'What you sell' });
    expect(list.contains(form)).toBe(false);
    expect(form.compareDocumentPosition(list) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Add a membership type' })).toBeNull();
    fireEvent.click(within(form).getByRole('button', { name: 'Cancel' }));
    expect(screen.getByRole('button', { name: 'Add a membership type' }).disabled).toBe(false);
  });

  it("a type being changed: in its own row, never another type's", async () => {
    open(listOf({ types: [type(), type({ name: 'Silver' })] }));
    fireEvent.click(await screen.findByRole('button', { name: 'Change Silver' }));
    const form = screen.getByRole('form', { name: 'Change membership type' });
    expect(rowOf('Silver').contains(form)).toBe(true);
    expect(rowOf('Gold Monthly').contains(form)).toBe(false);
    expect(within(form).getByLabelText('Name').value).toBe('Silver');
  });

  it('a refused save is said inside the form, beside its button, and goes with the form on Cancel', async () => {
    orgService.updateMembershipType.mockRejectedValue({
      response: { status: 409, data: { error: 'membership_type_name_taken', message: 'You already have a membership type with this name. Pick another name.' } },
    });
    open(listOf({ types: [type(), type({ name: 'Silver' })] }));
    fireEvent.click(await screen.findByRole('button', { name: 'Change Silver' }));
    type_('Name', 'Gold Monthly');
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    const said = await screen.findByRole('alert');
    expect(said.textContent).toBe('You already have a membership type with this name. Pick another name.');
    expect(screen.getByRole('form', { name: 'Change membership type' }).contains(said)).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByRole('form')).toBeNull();
  });

  it('an archive the server refuses is said on the page and brought into view', async () => {
    const had = Element.prototype.scrollIntoView;
    const into = vi.fn();
    Element.prototype.scrollIntoView = into;
    try {
      orgService.archiveMembershipType.mockRejectedValue({ response: { status: 500, data: {} } });
      open(listOf({ types: [type()] }));
      fireEvent.click(await screen.findByRole('button', { name: 'Archive Gold Monthly' }));
      fireEvent.click(screen.getByRole('button', { name: 'Archive' }));
      const said = await screen.findByRole('alert');
      expect(said.textContent).toBe("We couldn't archive that. Please try again.");
      await waitFor(() => expect(into.mock.instances.some((el) => el.contains(said))).toBe(true));
      expect(screen.getByText('Gold Monthly')).toBeTruthy();
    } finally {
      Element.prototype.scrollIntoView = had;
    }
  });
});

// Round one, H1: a form drawn in a row must never be left open with its row gone.
describe('while a form is open, nothing can take its row away', () => {
  const OLD = { ...type({ name: 'Old' }), archivedAt: '2026-10-01T09:00:00.000Z' };

  it('Put back waits, as Change and Archive do, and is back once the form is cancelled', async () => {
    open(listOf({ types: [type()], archived: [OLD], archivedTotal: 1 }));
    fireEvent.click(await screen.findByRole('button', { name: 'Show archived (1)' }));
    fireEvent.click(screen.getByRole('button', { name: 'Change Gold Monthly' }));
    expect(screen.getByRole('button', { name: 'Put back Old' }).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByRole('button', { name: 'Put back Old' }).disabled).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Add a membership type' }));
    expect(screen.getByRole('button', { name: 'Put back Old' }).disabled).toBe(true);
    expect(orgService.restoreMembershipType).not.toHaveBeenCalled();
  });
});

// SELL IN THE APP (18k-i; Kd, 2026-11-06): a tick on a paid-once membership or a pack with a price, never a trial, and
// not yet a repeating membership (18k-iv, after 18l); while Square can't take a payment, the place to set it up for
// whoever may, and a sentence for whoever may not.
describe('sell in the app (18k-i)', () => {
  const SQUARE = { state: 'connected', businessName: 'Iron House', locationName: 'Main', locations: [], connectedAt: '2026-10-20T09:00:00.000Z', removedAt: null };
  const box = (over = {}) => ({ availability: 'square', country: 'GB', canConnect: true, squareReady: true, square: SQUARE, terminals: null, needsAllow: false, allowFor: [], ...over });
  const OWNER = { ...ORG, slug: 'iron-house', staffRole: 'owner' };
  const MANAGER = { ...ORG, slug: 'iron-house', privileges: ['memberships.manage'] };
  const quarter = (over = {}) => type({ name: 'Quarter', kind: 'one_time', termCount: 3, termUnit: 'month', priceMinor: 12000, ...over });
  function openWith(list, payments, { org = OWNER, readOnly = false } = {}) {
    orgService.getMembershipTypes.mockResolvedValue({ data: list });
    if (payments !== undefined) orgService.getGymPayments.mockResolvedValueOnce({ data: { payments } });
    render(
      <MemoryRouter>
        <MembershipTypesPanel org={org} readOnly={readOnly} />
      </MemoryRouter>,
    );
  }
  const addPaidOnce = async () => {
    fireEvent.click(await screen.findByRole('button', { name: 'Add a membership type' }));
    fireEvent.click(screen.getByRole('radio', { name: /One-time payment/ }));
  };

  it('with Square connected: ticked, said, sent with the type, and its row reads Sold in the app', async () => {
    orgService.createMembershipType.mockResolvedValue({ data: listOf({ types: [quarter({ soldInApp: true })] }) });
    openWith(listOf(), box());
    await addPaidOnce();
    type_('Name', 'Quarter');
    type_('Price (GBP)', '120');
    const tick = await screen.findByRole('checkbox', { name: /Sell in the app/ });
    await waitFor(() => expect(screen.getByText('Members can buy it in the app and pay by card through Square.')).toBeTruthy());
    expect(tick.disabled).toBe(false);
    fireEvent.click(tick);
    fireEvent.click(screen.getByRole('button', { name: 'Add membership type' }));
    await waitFor(() => expect(orgService.createMembershipType).toHaveBeenCalledTimes(1));
    expect(orgService.createMembershipType.mock.calls[0][1]).toMatchObject({ kind: 'one_time', priceMinor: 12000, soldInApp: true });
    const row = (await screen.findAllByRole('listitem'))[0];
    expect(within(row).getByText('Sold in the app')).toBeTruthy();
  });

  it('a line not ticked says nothing of the app, and a change keeps the tick it has', async () => {
    orgService.updateMembershipType.mockResolvedValue({ data: listOf({ types: [quarter({ soldInApp: true })] }) });
    openWith(listOf({ types: [type({ name: 'Gold Monthly' }), quarter({ soldInApp: true })] }), box());
    const rows = await screen.findAllByRole('listitem');
    await waitFor(() => expect(within(rows[1]).getByText('Sold in the app')).toBeTruthy());
    expect(within(rows[0]).queryByText('Sold in the app')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Change Quarter' }));
    expect(screen.getByRole('checkbox', { name: /Sell in the app/ }).checked).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(orgService.updateMembershipType).toHaveBeenCalledTimes(1));
    expect(orgService.updateMembershipType.mock.calls[0][2]).toMatchObject({ soldInApp: true });
  });

  it('a repeating membership has no tick yet, and a trial never does', async () => {
    openWith(listOf(), box());
    fireEvent.click(await screen.findByRole('button', { name: 'Add a membership type' }));
    await waitFor(() => expect(orgService.getGymPayments).toHaveBeenCalled());
    expect(screen.getByRole('radio', { name: /Recurring/ }).checked).toBe(true);
    expect(screen.queryByRole('checkbox', { name: /Sell in the app/ })).toBeNull();
    fireEvent.click(screen.getByRole('radio', { name: /Trial/ }));
    expect(screen.queryByRole('checkbox', { name: /Sell in the app/ })).toBeNull();
    fireEvent.click(screen.getByRole('radio', { name: /Class pack/ }));
    expect(screen.getByRole('checkbox', { name: /Sell in the app/ })).toBeTruthy();
  });

  it('Square not connected, the owner: the tick is off, with Connect Square; a line already ticked says why members cannot buy it', async () => {
    openWith(listOf({ types: [quarter({ soldInApp: true })] }), box({ square: null }));
    const row = (await screen.findAllByRole('listitem'))[0];
    expect(await within(row).findByText("Members can't buy it in the app until Square is connected.")).toBeTruthy();
    expect(within(row).queryByText('Sold in the app')).toBeNull();
    expect(within(row).getByRole('link', { name: 'Connect Square' }).getAttribute('href')).toBe('/console/iron-house/settings#payments');
    await addPaidOnce();
    type_('Price (GBP)', '49.99');
    expect(screen.getByRole('checkbox', { name: /Sell in the app/ }).disabled).toBe(true);
    expect(screen.getByText('Connect Square to sell in the app.')).toBeTruthy();
    // Inside the form the button asks first: what was typed would be lost.
    fireEvent.click(screen.getByRole('button', { name: 'Connect Square' }));
    expect(screen.getByRole('link', { name: 'Leave this page' }).getAttribute('href')).toBe('/console/iron-house/settings#payments');
  });

  it('Square not connected, staff who cannot connect it: a sentence, no button', async () => {
    openWith(listOf({ types: [quarter({ soldInApp: true })] }), box({ square: null, canConnect: false }), { org: MANAGER });
    const row = (await screen.findAllByRole('listitem'))[0];
    expect(await within(row).findByText("Members can't buy it in the app until Square is connected.")).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Connect Square' })).toBeNull();
    await addPaidOnce();
    expect(screen.getByText('Only the owner can connect Square.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Connect Square' })).toBeNull();
  });

  it("Square's state not known: the form says only what the tick does, and the row only that it is on", async () => {
    // The Payments box never answers here (the mock's own default).
    openWith(listOf({ types: [quarter({ soldInApp: true })] }));
    const row = (await screen.findAllByRole('listitem'))[0];
    expect(within(row).getByText('Sell in the app: on')).toBeTruthy();
    expect(within(row).queryByText('Sold in the app')).toBeNull();
    await addPaidOnce();
    expect(screen.getByText('Lets members buy it in the app.')).toBeTruthy();
    expect(screen.queryByText('Members can buy it in the app and pay by card through Square.')).toBeNull();
    expect(screen.getByRole('checkbox', { name: /Sell in the app/ }).disabled).toBe(false);
  });

  it('a business with no plan with us: a ticked row says members cannot buy it, never Sold in the app, and offers no Square button', async () => {
    openWith(listOf({ types: [quarter({ soldInApp: true })] }), box(), { readOnly: true });
    const row = (await screen.findAllByRole('listitem'))[0];
    await waitFor(() => expect(orgService.getGymPayments).toHaveBeenCalled());
    expect(await within(row).findByText("Members can't buy it in the app until this gym has a plan.")).toBeTruthy();
    expect(within(row).queryByText('Sold in the app')).toBeNull();
    cleanup();
    // No plan and no Square: the sentence is the plan's, so no Connect Square beside it (re-check, N1).
    openWith(listOf({ types: [quarter({ soldInApp: true })] }), box({ square: null }), { readOnly: true });
    const again = (await screen.findAllByRole('listitem'))[0];
    await waitFor(() => expect(orgService.getGymPayments).toHaveBeenCalledTimes(2));
    expect(await within(again).findByText("Members can't buy it in the app until this gym has a plan.")).toBeTruthy();
    expect(within(again).queryByRole('link', { name: 'Connect Square' })).toBeNull();
  });

  it('a line already ticked can be unticked while Square is not connected', async () => {
    orgService.updateMembershipType.mockResolvedValue({ data: listOf({ types: [quarter()] }) });
    openWith(listOf({ types: [quarter({ soldInApp: true })] }), box({ square: null }));
    const row = (await screen.findAllByRole('listitem'))[0];
    await within(row).findByText("Members can't buy it in the app until Square is connected.");
    fireEvent.click(screen.getByRole('button', { name: 'Change Quarter' }));
    const tick = screen.getByRole('checkbox', { name: /Sell in the app/ });
    expect(tick.disabled).toBe(false);
    fireEvent.click(tick);
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(orgService.updateMembershipType).toHaveBeenCalledTimes(1));
    expect(orgService.updateMembershipType.mock.calls[0][2]).toMatchObject({ soldInApp: false });
  });

  it('a free day pass ticked is refused before Save', async () => {
    openWith(listOf(), box());
    fireEvent.click(await screen.findByRole('button', { name: 'Add a membership type' }));
    fireEvent.click(screen.getByRole('radio', { name: /Day pass/ }));
    type_('Name', 'Drop-in');
    type_('Price (GBP)', '0');
    await waitFor(() => expect(screen.getByText('Members can buy it in the app and pay by card through Square.')).toBeTruthy());
    fireEvent.click(screen.getByRole('checkbox', { name: /Sell in the app/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Add membership type' }));
    expect(await screen.findByText("A free membership can't be sold in the app. Untick Sell in the app.")).toBeTruthy();
    expect(orgService.createMembershipType).not.toHaveBeenCalled();
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
