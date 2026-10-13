// Settings → Waiver, as the owner sees it (ROADMAP 3e-i).
//
// The worst thing this box could do: change the words people have signed without the owner
// knowing everybody is asked again, or stop the waiver on one press. So the box says who
// is asked before Save, and Stop asks first.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('../../api/orgsApi', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, orgService: { getGymWaiver: vi.fn(), saveGymWaiver: vi.fn(), stopGymWaiver: vi.fn() } };
});

const { orgService } = await import('../../api/orgsApi');
const WaiverPanel = (await import('./WaiverPanel')).default;
const { readOnlyNote } = await import('../../pages/console/billingView');

const ORG = { id: '11111111-1111-4111-8111-111111111111', orgType: 'gym' };
const WORDS = 'I take part at my own risk.';
const waiver = (text = WORDS, version = 1) => ({ id: `22222222-2222-4222-8222-00000000000${String(version)}`, version, text, savedAt: '2026-10-13T09:00:00.000Z' });
const NONE = { waiver: null, inUse: false, people: 4, signed: 0 };
const IN_USE = { waiver: waiver(), inUse: true, people: 12, signed: 3 };

function open(data, { readOnly = false } = {}) {
  orgService.getGymWaiver.mockResolvedValue({ data });
  render(
    <MemoryRouter>
      <WaiverPanel org={ORG} readOnly={readOnly} membersTo="/console/iron-house/members" />
    </MemoryRouter>,
  );
  fireEvent.click(screen.getByRole('button', { name: /^waiver/i }));
}

const field = () => screen.findByLabelText('Your waiver');

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('a gym with no waiver', () => {
  it('says it is not set up, and Save waits for words', async () => {
    open(NONE);
    expect(await screen.findByText('Not set up')).toBeTruthy();
    const box = await field();
    expect(box.value).toBe('');
    expect(screen.getByRole('button', { name: 'Save waiver' }).disabled).toBe(true);
    expect(screen.queryByRole('button', { name: 'Stop using this waiver' })).toBeNull();
    expect(screen.queryByRole('group', { name: 'Who has signed' })).toBeNull();
  });

  it('says who will be asked before Save, saves the words typed, and says what happened beside the button', async () => {
    open(NONE);
    fireEvent.change(await field(), { target: { value: WORDS } });
    expect(screen.getByText('All 4 people in the app will be asked to sign it.')).toBeTruthy();
    orgService.saveGymWaiver.mockResolvedValue({ data: { waiver: waiver(), inUse: true, people: 4, signed: 0 } });
    fireEvent.click(screen.getByRole('button', { name: 'Save waiver' }));
    await waitFor(() => expect(orgService.saveGymWaiver).toHaveBeenCalledWith(ORG.id, WORDS));
    expect((await screen.findByRole('status')).textContent).toBe('Saved. 4 people in the app are now asked to sign it.');
    expect(screen.getByText('In use · 0 of 4 people in the app have signed')).toBeTruthy();
    // Saved, so there is nothing to save and the waiver can be stopped.
    expect(screen.getByRole('button', { name: 'Save changes' }).disabled).toBe(true);
    expect(screen.getByRole('button', { name: 'Stop using this waiver' })).toBeTruthy();
  });
});

describe('a gym whose waiver is in use', () => {
  it('shows its words, how many have signed, and where to see one person', async () => {
    open(IN_USE);
    expect((await field()).value).toBe(WORDS);
    const signed = screen.getByRole('group', { name: 'Who has signed' });
    expect(within(signed).getByText('3 of 12 people in the app have signed.')).toBeTruthy();
    expect(within(signed).getByRole('link', { name: 'Open Members' }).getAttribute('href')).toBe('/console/iron-house/members');
    expect(screen.getByRole('button', { name: 'Save changes' }).disabled).toBe(true);
  });

  it('says everybody is asked again before changed words are saved', async () => {
    open(IN_USE);
    fireEvent.change(await field(), { target: { value: `${WORDS} I follow staff instructions.` } });
    expect(screen.getByText('All 12 people in the app will be asked to sign again, because the words have changed.')).toBeTruthy();
    expect(orgService.saveGymWaiver).not.toHaveBeenCalled();
    // Typed back to what is saved: nothing to save, nobody asked.
    fireEvent.change(await field(), { target: { value: WORDS } });
    expect(screen.queryByText(/will be asked to sign/)).toBeNull();
    expect(screen.getByRole('button', { name: 'Save changes' }).disabled).toBe(true);
  });

  it('a save that fails says so and keeps the words typed', async () => {
    open(IN_USE);
    const typed = `${WORDS} More.`;
    fireEvent.change(await field(), { target: { value: typed } });
    orgService.saveGymWaiver.mockRejectedValue({ response: { status: 409, data: { error: 'gym_not_on_plan', message: 'Choose a plan to change this.' } } });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByText('Choose a plan to change this.')).toBeTruthy();
    expect((await field()).value).toBe(typed);
  });

  it('Stop asks first, naming who changes and what is kept, and Keep using it changes nothing', async () => {
    open(IN_USE);
    await field();
    fireEvent.click(screen.getByRole('button', { name: 'Stop using this waiver' }));
    const ask = screen.getByRole('group', { name: 'Stop using this waiver?' });
    expect(within(ask).getByText('Nobody will be asked to sign it: not people who join, and not people already in the app.')).toBeTruthy();
    expect(within(ask).getByText('Its words and the 3 signatures you have are kept, so you can start using it again.')).toBeTruthy();
    expect(orgService.stopGymWaiver).not.toHaveBeenCalled();
    fireEvent.click(within(ask).getByRole('button', { name: 'Keep using it' }));
    expect(screen.queryByRole('group', { name: 'Stop using this waiver?' })).toBeNull();
    expect(orgService.stopGymWaiver).not.toHaveBeenCalled();
  });

  it('stopped, it says so in the same place, keeps the words, and offers to use them again', async () => {
    open(IN_USE);
    await field();
    fireEvent.click(screen.getByRole('button', { name: 'Stop using this waiver' }));
    orgService.stopGymWaiver.mockResolvedValue({ data: { ...IN_USE, inUse: false } });
    fireEvent.click(screen.getByRole('button', { name: 'Stop using it' }));
    expect((await screen.findByRole('status')).textContent).toBe('You have stopped using this waiver. Nobody is asked to sign it.');
    expect(screen.getByText('Not in use')).toBeTruthy();
    expect((await field()).value).toBe(WORDS);
    expect(screen.queryByRole('group', { name: 'Who has signed' })).toBeNull();
    const again = screen.getByRole('button', { name: 'Use this waiver' });
    expect(again.disabled).toBe(false);
    orgService.saveGymWaiver.mockResolvedValue({ data: IN_USE });
    fireEvent.click(again);
    await waitFor(() => expect(orgService.saveGymWaiver).toHaveBeenCalledWith(ORG.id, WORDS));
    expect(await screen.findByRole('group', { name: 'Who has signed' })).toBeTruthy();
  });
});

describe('when it cannot be read or changed', () => {
  it('a failed read says so, and Try again reads it', async () => {
    orgService.getGymWaiver.mockRejectedValueOnce({ response: { status: 500, data: {} } }).mockResolvedValueOnce({ data: IN_USE });
    render(
      <MemoryRouter>
        <WaiverPanel org={ORG} readOnly={false} />
      </MemoryRouter>,
    );
    expect(await screen.findByText("We couldn't load your waiver.")).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect((await field()).value).toBe(WORDS);
  });

  it('a gym on no plan reads its waiver and can change nothing', async () => {
    open(IN_USE, { readOnly: true });
    expect((await field()).disabled).toBe(true);
    expect(screen.getByText(readOnlyNote('gym'))).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Stop using this waiver' }).disabled).toBe(true);
    expect(screen.getByRole('button', { name: 'Save changes' }).disabled).toBe(true);
  });
});
