// Settings → Who can check in, as the owner sees it (spec Part 3 §12.4; ROADMAP 16d).
//
// The worst thing this box could do: save a choice that turns people away without the
// owner having seen who. So Save waits for the names, and a choice picked and not saved
// changes nothing.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('../../api/orgsApi', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    orgService: {
      getCheckinRules: vi.fn(),
      updateCheckinRules: vi.fn(),
      previewCheckinRules: vi.fn(),
    },
  };
});

const { orgService } = await import('../../api/orgsApi');
const CheckinRulesPanel = (await import('./CheckinRulesPanel')).default;
const { readOnlyNote } = await import('../../pages/console/billingView');

const ORG = { id: '11111111-1111-4111-8111-111111111111', orgType: 'gym', timezone: 'Europe/London', clockFormat: '24h' };
const START = { who: 'everyone', overdue: 'let_in' };

const PEOPLE = [
  ['Cara Cancelled', 'cancelled'],
  ['Ed Ended', 'ended'],
  ['Fran Frozen', 'frozen'],
  ['Nia Next', 'not_started'],
  ['Noel Nothing', 'no_membership'],
].map(([name, reason], i) => ({ entryId: `22222222-2222-4222-8222-${String(i).padStart(12, '0')}`, name, reason }));

/** The server's answer for each pair of choices: who it would stop today, of 13 people. */
function previewFor(rules) {
  const notCurrent = rules.who === 'current_membership' ? PEOPLE : [];
  const overdue = rules.overdue === 'see_staff' ? [{ entryId: '22222222-2222-4222-8222-0000000000aa', name: 'Owen Owes', reason: 'overdue' }] : [];
  const people = [...notCurrent, ...overdue];
  return { data: { rules, listed: 13, stopped: people.length, notListed: rules.who === 'current_membership' ? 2 : 0, people } };
}

function open({ rules = START, overdueAfterDays = 0, readOnly = false } = {}) {
  orgService.getCheckinRules.mockResolvedValue({ data: { rules, overdueAfterDays } });
  orgService.previewCheckinRules.mockImplementation((_gymId, asked) => Promise.resolve(previewFor(asked)));
  render(
    <MemoryRouter>
      <CheckinRulesPanel org={ORG} readOnly={readOnly} attendanceTo="/console/iron-house/attendance" />
    </MemoryRouter>,
  );
  fireEvent.click(screen.getByRole('button', { name: /who can check in/i }));
}

const saveButton = () => screen.getByRole('button', { name: 'Save changes' });
const today = () => screen.findByRole('group', { name: 'Who is sent to staff today' });

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('the closed box says what is saved', () => {
  it('where a gym starts', async () => {
    orgService.getCheckinRules.mockResolvedValue({ data: { rules: START, overdueAfterDays: 0 } });
    orgService.previewCheckinRules.mockResolvedValue(previewFor(START));
    render(
      <MemoryRouter>
        <CheckinRulesPanel org={ORG} readOnly={false} />
      </MemoryRouter>,
    );
    expect(await screen.findByText('Everyone on your list')).toBeTruthy();
  });

  it('a failed read opens the box and says so, and Try again reads again', async () => {
    orgService.getCheckinRules.mockRejectedValueOnce({ response: { status: 500, data: {} } }).mockResolvedValueOnce({ data: { rules: START, overdueAfterDays: 0 } });
    orgService.previewCheckinRules.mockResolvedValue(previewFor(START));
    render(
      <MemoryRouter>
        <CheckinRulesPanel org={ORG} readOnly={false} />
      </MemoryRouter>,
    );
    expect(await screen.findByText("We couldn't load who can check in.")).toBeTruthy();
    expect(screen.queryByText('Save changes')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(await screen.findByRole('button', { name: 'Save changes' })).toBeTruthy();
  });
});

describe('picking who can check in', () => {
  it('starts on what is saved, with nothing to save and nobody stopped', async () => {
    open();
    const box = await today();
    expect(within(box).getByText('All 13 people on your list are checked in at the front desk today.')).toBeTruthy();
    expect(screen.getByRole('radio', { name: /everyone on your list/i }).checked).toBe(true);
    expect(screen.getByRole('radio', { name: /^check them in/i }).checked).toBe(true);
    expect(saveButton().disabled).toBe(true);
    expect(screen.getByText('A payment is overdue from the day after it was due.')).toBeTruthy();
  });

  it('names who the choice would stop and how many it would not, before anything is saved', async () => {
    open();
    await today();
    fireEvent.click(screen.getByRole('radio', { name: /only people with a current membership/i }));
    const box = await today();
    expect(await within(box).findByText('Today 5 of the 13 people on your list would be sent to staff:')).toBeTruthy();
    // A few names with why, then how many more.
    expect(within(box).getByText('Cara Cancelled')).toBeTruthy();
    expect(within(box).getByText('· Membership cancelled')).toBeTruthy();
    expect(within(box).getByText('Fran Frozen')).toBeTruthy();
    expect(within(box).queryByText('Noel Nothing')).toBeNull();
    expect(within(box).getByText('and 2 more')).toBeTruthy();
    expect(within(box).getByText('The other 8 would be checked in as now.')).toBeTruthy();
    // People in the app who are on no record are stopped too, and the box says so.
    expect(within(box).getByText('2 people in the app who are not on your Members list would also be sent to staff.')).toBeTruthy();
    expect(within(box).getByText(/Your own staff are always checked in when they scan their own pass\./)).toBeTruthy();
    // What the person at the desk reads, and where staff go.
    expect(within(box).getByText(/Please see a member of staff/)).toBeTruthy();
    expect(within(box).getByRole('link', { name: 'Open Attendance' }).getAttribute('href')).toBe('/console/iron-house/attendance');
    // Nothing was saved by picking.
    expect(orgService.updateCheckinRules).not.toHaveBeenCalled();
    expect(saveButton().disabled).toBe(false);

    fireEvent.click(within(box).getByRole('button', { name: 'See all' }));
    expect(within(box).getByText('Noel Nothing')).toBeTruthy();
    expect(within(box).getByText('· No membership')).toBeTruthy();
    expect(within(box).queryByText(/more$/)).toBeNull();
  });

  it('Save sends both choices and says what the desk now does', async () => {
    open();
    await today();
    fireEvent.click(screen.getByRole('radio', { name: /only people with a current membership/i }));
    fireEvent.click(screen.getByRole('radio', { name: /send them to staff/i }));
    expect(await screen.findByText('Today 6 of the 13 people on your list would be sent to staff:')).toBeTruthy();
    const strict = { who: 'current_membership', overdue: 'see_staff' };
    orgService.updateCheckinRules.mockResolvedValue({ data: { rules: strict, overdueAfterDays: 0 } });
    fireEvent.click(saveButton());
    await waitFor(() => expect(orgService.updateCheckinRules).toHaveBeenCalledWith(ORG.id, strict));
    expect(
      await screen.findByText('Saved. Your front desk follows this from the next scan. 6 people on your list would be sent to staff if they came today.'),
    ).toBeTruthy();
    expect(saveButton().disabled).toBe(true);
    // The box now speaks of what is, not what would be.
    expect(screen.getByText('Today 6 of the 13 people on your list are sent to staff:')).toBeTruthy();
    expect(screen.getByText('Only people with a current membership · overdue payments sent to staff')).toBeTruthy();
  });

  it('Save waits for the names: it cannot be pressed while who it stops is being worked out, or could not be', async () => {
    open();
    await today();
    let answer;
    orgService.previewCheckinRules.mockImplementationOnce(() => new Promise((resolve) => (answer = resolve)));
    fireEvent.click(screen.getByRole('radio', { name: /only people with a current membership/i }));
    expect(await screen.findByText('Working out who this stops…')).toBeTruthy();
    expect(saveButton().disabled).toBe(true);
    answer(previewFor({ who: 'current_membership', overdue: 'let_in' }));
    await waitFor(() => expect(saveButton().disabled).toBe(false));

    orgService.previewCheckinRules.mockRejectedValueOnce({ response: { status: 500, data: {} } });
    fireEvent.click(screen.getByRole('radio', { name: /send them to staff/i }));
    expect(await screen.findByText("We couldn't work out who this stops.")).toBeTruthy();
    expect(saveButton().disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(await screen.findByText('Today 6 of the 13 people on your list would be sent to staff:')).toBeTruthy();
    expect(saveButton().disabled).toBe(false);
  });

  it('a refused save is said beside the button, and the choice stays picked', async () => {
    open();
    await today();
    fireEvent.click(screen.getByRole('radio', { name: /send them to staff/i }));
    await screen.findByText('Today 1 of the 13 people on your list would be sent to staff:');
    orgService.updateCheckinRules.mockRejectedValue({ response: { status: 409, data: { message: 'Your plan has ended. Choose a plan to change this.' } } });
    fireEvent.click(saveButton());
    expect(await screen.findByText('Your plan has ended. Choose a plan to change this.')).toBeTruthy();
    expect(screen.getByRole('radio', { name: /send them to staff/i }).checked).toBe(true);
    expect(saveButton().disabled).toBe(false);
  });

  it('says the gym’s own days of grace', async () => {
    open({ overdueAfterDays: 7 });
    expect(await screen.findByText('A payment is overdue once it is more than 7 days late.')).toBeTruthy();
  });

  it('a gym on no plan reads its choice and cannot change it', async () => {
    open({ rules: { who: 'current_membership', overdue: 'let_in' }, readOnly: true });
    expect(await screen.findByText(readOnlyNote('gym'))).toBeTruthy();
    await today();
    for (const radio of screen.getAllByRole('radio')) expect(radio.disabled).toBe(true);
    expect(saveButton().disabled).toBe(true);
  });
});
