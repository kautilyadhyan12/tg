// Settings → Membership agreement, as the owner sees it (ROADMAP 18u-i).
//
// The worst thing this box could do: change words people have signed without the owner knowing
// what becomes of them, or stop the agreement on one press. So the box says before Save that
// signed memberships keep their words, and Stop asks first.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('../../api/orgsApi', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, orgService: { getGymAgreement: vi.fn(), saveGymAgreement: vi.fn(), stopGymAgreement: vi.fn() } };
});

const { orgService } = await import('../../api/orgsApi');
const AgreementPanel = (await import('./AgreementPanel')).default;

const ORG = { id: '11111111-1111-4111-8111-111111111111', orgType: 'gym' };
const WORDS = 'Cancel at the front desk with 30 days notice.';
const agreement = (text = WORDS, version = 1) => ({ id: `22222222-2222-4222-8222-00000000000${String(version)}`, version, text, savedAt: '2026-10-23T09:00:00.000Z' });
const NONE = { agreement: null, inUse: false, signed: 0 };
const IN_USE = { agreement: agreement(), inUse: true, signed: 3 };

function open(data) {
  orgService.getGymAgreement.mockResolvedValue({ data });
  render(
    <MemoryRouter>
      <AgreementPanel org={ORG} readOnly={false} membersTo="/console/iron-house/members" membersName="Members & staff" />
    </MemoryRouter>,
  );
  fireEvent.click(screen.getByRole('button', { name: /^membership agreement/i }));
}

const field = () => screen.findByLabelText('Your terms');

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('a business with no agreement', () => {
  it('says it is not set up, says what the app fills in, and saves the words typed', async () => {
    open(NONE);
    expect(await screen.findByText('Not set up')).toBeTruthy();
    const note = await screen.findByRole('note');
    expect(within(note).getByText('You can write your membership agreement here.')).toBeTruthy();
    expect(within(note).getByText(/Press Save agreement to start\./)).toBeTruthy();
    expect(screen.getByText(/^These are your own terms: this app doesn't write or check them\./)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Save agreement' }).disabled).toBe(true);
    fireEvent.change(await field(), { target: { value: WORDS } });
    orgService.saveGymAgreement.mockResolvedValue({ data: { agreement: agreement(), inUse: true, signed: 0 } });
    fireEvent.click(screen.getByRole('button', { name: 'Save agreement' }));
    expect((await screen.findByRole('status')).textContent).toBe('Saved. Each membership you give from now on is signed with it.');
    expect(orgService.saveGymAgreement).toHaveBeenCalledWith(ORG.id, WORDS);
    expect(screen.queryByRole('note')).toBeNull();
  });
});

describe('a business whose agreement is in use', () => {
  it('says how many memberships were signed, and before Save that signed ones keep their words', async () => {
    open(IN_USE);
    expect(await screen.findByText('Signed for 3 memberships.')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Open Members & staff' }).getAttribute('href')).toBe('/console/iron-house/members');
    fireEvent.change(await field(), { target: { value: `${WORDS}\nFreezes cost $10.00 a month.` } });
    expect(screen.getByText('The memberships already signed keep the words they were signed with. Memberships you give from now on are signed with the new words.')).toBeTruthy();
    orgService.saveGymAgreement.mockResolvedValue({ data: { agreement: agreement(`${WORDS}\nFreezes cost $10.00 a month.`, 2), inUse: true, signed: 0 } });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    expect((await screen.findByRole('status')).textContent).toBe('Saved. Memberships you give from now on are signed with these words.');
  });

  it('Stop asks first, says who changes and what is kept, and Keep using it changes nothing', async () => {
    open(IN_USE);
    fireEvent.click(await screen.findByRole('button', { name: 'Stop using this agreement' }));
    const ask = screen.getByRole('group', { name: 'Stop using this agreement?' });
    expect(within(ask).getByText('Nobody will be asked to sign it when you give a membership.')).toBeTruthy();
    expect(within(ask).getByText('Its words and the 3 signed memberships are kept, so you can start using it again.')).toBeTruthy();
    fireEvent.click(within(ask).getByRole('button', { name: 'Keep using it' }));
    expect(orgService.stopGymAgreement).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Stop using this agreement' }));
    orgService.stopGymAgreement.mockResolvedValue({ data: { ...IN_USE, inUse: false } });
    fireEvent.click(within(screen.getByRole('group', { name: 'Stop using this agreement?' })).getByRole('button', { name: 'Stop using it' }));
    expect((await screen.findByRole('status')).textContent).toBe('You have stopped using this agreement. Nobody is asked to sign it.');
    expect(screen.getByRole('button', { name: 'Use this agreement' })).toBeTruthy();
  });
});
