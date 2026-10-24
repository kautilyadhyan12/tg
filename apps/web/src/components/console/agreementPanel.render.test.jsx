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
  return { ...actual, orgService: { getGymAgreement: vi.fn(), saveGymAgreement: vi.fn(), stopGymAgreement: vi.fn(), addOtherAgreement: vi.fn(), saveOtherAgreement: vi.fn(), stopOtherAgreement: vi.fn() } };
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

const field = () => screen.findByLabelText('Default agreement');

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('a business with no agreement', () => {
  it('says it is not set up, says what the app fills in, and saves the words typed', async () => {
    open(NONE);
    expect(await screen.findByText('Not set up')).toBeTruthy();
    const note = await screen.findByRole('note');
    expect(within(note).getByText('No membership agreement yet.')).toBeTruthy();
    expect(within(note).getByText(/receive a copy by email\./)).toBeTruthy();
    expect(screen.getByText(/^We do not write or review your terms\./)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Save agreement' }).disabled).toBe(true);
    fireEvent.change(await field(), { target: { value: WORDS } });
    orgService.saveGymAgreement.mockResolvedValue({ data: { agreement: agreement(), inUse: true, signed: 0 } });
    fireEvent.click(screen.getByRole('button', { name: 'Save agreement' }));
    expect((await screen.findByRole('status')).textContent).toBe('Agreement saved. Members sign it when they get a membership.');
    expect(orgService.saveGymAgreement).toHaveBeenCalledWith(ORG.id, WORDS);
    expect(screen.queryByRole('note')).toBeNull();
  });
});

describe('a business whose agreement is in use', () => {
  it('says how many memberships were signed, and before Save that signed ones keep their words', async () => {
    open(IN_USE);
    expect(await screen.findByText('3 signed')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Open Members & staff' }).getAttribute('href')).toBe('/console/iron-house/members');
    fireEvent.change(await field(), { target: { value: `${WORDS}\nFreezes cost $10.00 a month.` } });
    expect(screen.getByText('Agreements already signed are not changed. New memberships are signed with the new terms.')).toBeTruthy();
    orgService.saveGymAgreement.mockResolvedValue({ data: { agreement: agreement(`${WORDS}\nFreezes cost $10.00 a month.`, 2), inUse: true, signed: 0 } });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    expect((await screen.findByRole('status')).textContent).toBe('Changes saved. New memberships are signed with the new terms.');
  });

  it('Stop asks first, says who changes and what is kept, and Cancel changes nothing', async () => {
    open(IN_USE);
    fireEvent.click(await screen.findByRole('button', { name: 'Turn off' }));
    const ask = screen.getByRole('group', { name: 'Turn off this agreement?' });
    expect(within(ask).getByText('Members will not be asked to sign an agreement when they get a membership.')).toBeTruthy();
    expect(within(ask).getByText('Signed agreements are kept. You can turn it back on at any time.')).toBeTruthy();
    fireEvent.click(within(ask).getByRole('button', { name: 'Cancel' }));
    expect(orgService.stopGymAgreement).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Turn off' }));
    orgService.stopGymAgreement.mockResolvedValue({ data: { ...IN_USE, inUse: false } });
    fireEvent.click(within(screen.getByRole('group', { name: 'Turn off this agreement?' })).getByRole('button', { name: 'Turn off' }));
    expect((await screen.findByRole('status')).textContent).toBe('Agreement turned off. Members are not asked to sign it.');
    expect(screen.getByRole('button', { name: 'Use this agreement' })).toBeTruthy();
  });
});

// ── Another agreement for some lines of the price list (18u-ii-a) ──

const PACK = { id: '33333333-3333-4333-8333-000000000001', name: '10-class pack', agreementId: null };
const TRIAL = { id: '33333333-3333-4333-8333-000000000002', name: 'Free week', agreementId: null };
const YEARLY = { id: '33333333-3333-4333-8333-000000000003', name: 'Yearly', agreementId: null };
const PACK_TERMS = 'Classes expire 60 days after purchase.';
const OTHER_ID = '44444444-4444-4444-8444-000000000001';
const other = (over = {}) => ({ id: OTHER_ID, name: 'Class pack terms', agreement: agreement(PACK_TERMS), inUse: true, signed: 1, ...over });

describe('another agreement for some memberships', () => {
  it('a business with one agreement sees its terms as before, with Add agreement and one line under it', async () => {
    open({ ...IN_USE, others: [], prices: [PACK, YEARLY] });
    expect(await field()).toBeTruthy();
    expect(screen.queryByText('Other agreements')).toBeNull();
    expect(screen.getByText('Add a separate agreement for memberships with different terms, for example class packs.')).toBeTruthy();
    expect(screen.queryByRole('group', { name: 'Used for' })).toBeNull();
  });

  it('Add agreement opens its form under it: name, terms and the memberships it is for; Save sends them and says who signs it', async () => {
    open({ ...IN_USE, others: [], prices: [PACK, TRIAL, YEARLY] });
    fireEvent.click(await screen.findByRole('button', { name: 'Add agreement' }));
    const form = screen.getByRole('form', { name: 'Add agreement' });
    expect(within(form).getByText("Memberships you don't select use the default agreement.")).toBeTruthy();
    const save = within(form).getByRole('button', { name: 'Save agreement' });
    expect(save.disabled).toBe(true);
    fireEvent.change(within(form).getByLabelText('Name'), { target: { value: 'Class pack terms' } });
    fireEvent.change(within(form).getByLabelText('Terms'), { target: { value: PACK_TERMS } });
    fireEvent.click(within(form).getByRole('checkbox', { name: '10-class pack' }));
    // A name the business already uses is said before Save.
    fireEvent.change(within(form).getByLabelText('Name'), { target: { value: 'default agreement' } });
    expect(within(form).getByRole('alert').textContent).toBe('You already have an agreement called Default agreement. Give this one another name.');
    expect(save.disabled).toBe(true);
    fireEvent.change(within(form).getByLabelText('Name'), { target: { value: 'Class pack terms' } });
    orgService.addOtherAgreement.mockResolvedValue({ data: { ...IN_USE, others: [other({ signed: 0 })], prices: [{ ...PACK, agreementId: OTHER_ID }, TRIAL, YEARLY] } });
    fireEvent.click(save);
    expect((await screen.findByRole('status')).textContent).toBe('Class pack terms saved. Members who get 10-class pack will sign it.');
    expect(orgService.addOtherAgreement).toHaveBeenCalledWith(ORG.id, { name: 'Class pack terms', text: PACK_TERMS, usedFor: [PACK.id] });
    expect(screen.getByText('Default agreement')).toBeTruthy();
    expect(screen.getByText('Used for all memberships except: 10-class pack.')).toBeTruthy();
    expect(screen.getByTestId('agreement-words').textContent).toBe(PACK_TERMS);
    expect(screen.getByText('A membership agreement is signed each time a member gets a membership. It covers the price, renewal and cancellation. Use one agreement for all memberships, or add separate agreements for memberships with different terms.')).toBeTruthy();
    expect(screen.getByText('Used for: 10-class pack · 0 signed')).toBeTruthy();
  });

  it('Edit opens the form under its row; before Save it says which memberships move and that signed ones keep theirs', async () => {
    const trialTerms = { ...other({ id: '44444444-4444-4444-8444-000000000002', name: 'Trial terms', signed: 0 }) };
    open({ ...IN_USE, others: [other(), trialTerms], prices: [{ ...PACK, agreementId: OTHER_ID }, { ...TRIAL, agreementId: trialTerms.id }, YEARLY] });
    fireEvent.click(await screen.findByRole('button', { name: 'Edit Class pack terms' }));
    const form = screen.getByRole('form', { name: 'Change Class pack terms' });
    expect(within(form).getByText('Currently uses Trial terms')).toBeTruthy();
    // The same signed box as under the default agreement.
    expect(within(within(form).getByRole('group', { name: 'Who has signed' })).getByText('1 signed')).toBeTruthy();
    expect(within(form).getByRole('link', { name: 'Open Members & staff' }).getAttribute('href')).toBe('/console/iron-house/members');
    fireEvent.click(within(form).getByRole('checkbox', { name: '10-class pack' }));
    fireEvent.click(within(form).getByRole('checkbox', { name: /^Free week/ }));
    expect(within(form).getByText('Free week will move from Trial terms to this agreement.')).toBeTruthy();
    expect(within(form).getByText('10-class pack will use the default agreement.')).toBeTruthy();
    expect(within(form).getByText('Agreements already signed are not changed.')).toBeTruthy();
    fireEvent.click(within(form).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('form', { name: 'Change Class pack terms' })).toBeNull();
    expect(orgService.saveOtherAgreement).not.toHaveBeenCalled();
  });

  it('Stop asks first and names the memberships that will ask for no agreement', async () => {
    open({ ...IN_USE, others: [other()], prices: [{ ...PACK, agreementId: OTHER_ID }, YEARLY] });
    fireEvent.click(await screen.findByRole('button', { name: 'Edit Class pack terms' }));
    const form = screen.getByRole('form', { name: 'Change Class pack terms' });
    fireEvent.click(within(form).getByRole('button', { name: 'Turn off' }));
    const ask = within(form).getByRole('group', { name: 'Turn off Class pack terms?' });
    expect(within(ask).getByText("Members who get 10-class pack will not be asked to sign an agreement.")).toBeTruthy();
    expect(within(ask).getByText('Signed agreements are kept. You can turn it back on at any time.')).toBeTruthy();
    orgService.stopOtherAgreement.mockResolvedValue({ data: { ...IN_USE, others: [other({ inUse: false })], prices: [{ ...PACK, agreementId: OTHER_ID }, YEARLY] } });
    fireEvent.click(within(ask).getByRole('button', { name: 'Turn off' }));
    expect((await screen.findByRole('status')).textContent).toBe('Class pack terms turned off. Members are not asked to sign it.');
    expect(orgService.stopOtherAgreement).toHaveBeenCalledWith(ORG.id, OTHER_ID);
    expect(screen.getByText('Turned off. Members are not asked to sign it.')).toBeTruthy();
  });

  it("the price list's Change agreement opens that agreement's form at once", async () => {
    orgService.getGymAgreement.mockResolvedValue({ data: { ...IN_USE, others: [other()], prices: [{ ...PACK, agreementId: OTHER_ID }] } });
    render(
      <MemoryRouter>
        <AgreementPanel org={ORG} readOnly={false} startOpen openAgreementId={OTHER_ID} />
      </MemoryRouter>,
    );
    expect(await screen.findByRole('form', { name: 'Change Class pack terms' })).toBeTruthy();
  });
});
