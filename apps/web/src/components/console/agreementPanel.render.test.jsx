// Settings → Membership agreement, as the owner sees it (ROADMAP 18u-i).
//
// The worst thing this box could do: change words people have signed without the owner knowing
// what becomes of them, or stop the agreement on one press. So the box says before Save that
// signed memberships keep their words, and Stop asks first.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('../../api/orgsApi', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, orgService: { getGymAgreement: vi.fn(), saveGymAgreement: vi.fn(), stopGymAgreement: vi.fn(), addOtherAgreement: vi.fn(), saveOtherAgreement: vi.fn(), stopOtherAgreement: vi.fn(), getAgreementBookings: vi.fn(() => Promise.resolve({ data: { rule: 'let_book', inUse: true, stopped: null } })), setAgreementBookings: vi.fn() } };
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
    // With the price list as the screen showed it, so a line moved since is never saved over.
    expect(orgService.addOtherAgreement).toHaveBeenCalledWith(ORG.id, {
      name: 'Class pack terms',
      text: PACK_TERMS,
      usedFor: [PACK.id],
      seen: [PACK, TRIAL, YEARLY].map((p) => ({ id: p.id, agreementId: null })),
    });
    expect(screen.getByText('Default agreement')).toBeTruthy();
    expect(screen.getByText('Used for all memberships except: 10-class pack.')).toBeTruthy();
    // The agreement just saved is shown open, its words in their own box, no Edit to press.
    expect(screen.getByRole('button', { name: /^Class pack terms/ }).getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByRole('form', { name: 'Change Class pack terms' })).toBeTruthy();
    expect(screen.getByDisplayValue(PACK_TERMS)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^Edit/ })).toBeNull();
    expect(screen.getByText('A membership agreement is signed each time a member gets a membership. It covers the price, renewal and cancellation. Use one agreement for all memberships, or add separate agreements for memberships with different terms.')).toBeTruthy();
    expect(screen.getByText('Used for: 10-class pack · 0 signed')).toBeTruthy();
  });

  it('each other agreement is a row that opens when pressed; before Save it says which memberships move and that signed ones keep theirs', async () => {
    const trialTerms = { ...other({ id: '44444444-4444-4444-8444-000000000002', name: 'Trial terms', signed: 0 }) };
    open({ ...IN_USE, others: [other(), trialTerms], prices: [{ ...PACK, agreementId: OTHER_ID }, { ...TRIAL, agreementId: trialTerms.id }, YEARLY] });
    const row = await screen.findByRole('button', { name: /^Class pack terms/ });
    expect(row.getAttribute('aria-expanded')).toBe('false');
    expect(within(row).getByText('Used for: 10-class pack · 1 signed')).toBeTruthy();
    expect(screen.queryByRole('form', { name: 'Change Class pack terms' })).toBeNull();
    fireEvent.click(row);
    const form = screen.getByRole('form', { name: 'Change Class pack terms' });
    expect(within(form).getByText('Currently uses Trial terms')).toBeTruthy();
    expect(within(form).queryByRole('button', { name: 'Cancel' })).toBeNull();
    // The same signed box as under the default agreement.
    expect(within(within(form).getByRole('group', { name: 'Who has signed' })).getByText('1 signed')).toBeTruthy();
    expect(within(form).getByRole('link', { name: 'Open Members & staff' }).getAttribute('href')).toBe('/console/iron-house/members');
    fireEvent.click(within(form).getByRole('checkbox', { name: '10-class pack' }));
    fireEvent.click(within(form).getByRole('checkbox', { name: /^Free week/ }));
    expect(within(form).getByText('Free week will move from Trial terms to this agreement.')).toBeTruthy();
    expect(within(form).getByText('10-class pack will use the default agreement.')).toBeTruthy();
    expect(within(form).getByText('Agreements already signed are not changed.')).toBeTruthy();
    expect(orgService.saveOtherAgreement).not.toHaveBeenCalled();
    // Pressed again, it closes.
    fireEvent.click(row);
    expect(screen.queryByRole('form', { name: 'Change Class pack terms' })).toBeNull();
  });

  it('Stop asks first and names the memberships that will ask for no agreement', async () => {
    open({ ...IN_USE, others: [other()], prices: [{ ...PACK, agreementId: OTHER_ID }, YEARLY] });
    fireEvent.click(await screen.findByRole('button', { name: /^Class pack terms/ }));
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

  it('a line another member of staff moved since the screen loaded: nothing saved, Settings read again, and why said under its row', async () => {
    open({ ...IN_USE, others: [other()], prices: [{ ...PACK, agreementId: OTHER_ID }, YEARLY] });
    fireEvent.click(await screen.findByRole('button', { name: /^Class pack terms/ }));
    const form = screen.getByRole('form', { name: 'Change Class pack terms' });
    fireEvent.change(within(form).getByLabelText('Terms'), { target: { value: `${PACK_TERMS} More.` } });
    const said = 'The memberships for your agreements were changed by someone else. Check them again, then save.';
    orgService.saveOtherAgreement.mockRejectedValue(Object.assign(new Error('refused'), { response: { status: 409, data: { error: 'prices_changed', message: said } } }));
    orgService.getGymAgreement.mockResolvedValue({ data: { ...IN_USE, others: [other()], prices: [{ ...PACK, agreementId: '44444444-4444-4444-8444-000000000009' }, YEARLY] } });
    fireEvent.click(within(form).getByRole('button', { name: 'Save changes' }));
    expect((await screen.findByText(said)).textContent).toBe(said);
    expect(orgService.getGymAgreement).toHaveBeenCalledTimes(2);
  });

  it('with no default agreement yet, Settings says so and says nothing it is used for', async () => {
    open({ ...NONE, others: [other()], prices: [{ ...PACK, agreementId: OTHER_ID }, YEARLY] });
    expect(await screen.findByText('No default agreement yet.')).toBeTruthy();
    expect(screen.queryByText(/^Used for all memberships/)).toBeNull();
  });

  it("the price list's Open agreement shows that agreement open, at its own address on the page", async () => {
    orgService.getGymAgreement.mockResolvedValue({ data: { ...IN_USE, others: [other()], prices: [{ ...PACK, agreementId: OTHER_ID }] } });
    render(
      <MemoryRouter>
        <AgreementPanel org={ORG} readOnly={false} startOpen openAgreementId={OTHER_ID} />
      </MemoryRouter>,
    );
    const form = await screen.findByRole('form', { name: 'Change Class pack terms' });
    expect(form.closest(`#agreement-${OTHER_ID}`)).not.toBeNull();
  });
});

describe('Before they book: no new bookings until the membership agreement is signed (18u-iv)', () => {
  const bid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
  const NAMES = ['Ana Lopez', 'Ben Okafor', 'Chloe Martin', 'Dev Patel', 'Ella Rossi'];
  const STOPPED = { count: 8, staff: 0, people: NAMES.map((name, n) => ({ entryId: bid(n + 1), name })) };

  it('names who has one to sign, says what the choice does, See all opens Members, and its own Save sends it', async () => {
    orgService.getAgreementBookings.mockResolvedValueOnce({ data: { rule: 'let_book', inUse: true, stopped: STOPPED } });
    orgService.setAgreementBookings.mockResolvedValueOnce({ data: { rule: 'stop', inUse: true, stopped: STOPPED } });
    open(IN_USE);
    expect(await screen.findByText('Before they book')).toBeTruthy();
    expect(screen.getByText("What happens when a member who hasn't signed their membership agreement tries to book in the app.")).toBeTruthy();
    expect(screen.getByRole('radio', { name: 'Let them book' }).checked).toBe(true);
    const box = screen.getByRole('group', { name: 'Who has a membership agreement to sign today' });
    expect(within(box).getByText('Today 8 people on your list have a membership agreement to sign:')).toBeTruthy();
    expect(within(box).getAllByRole('listitem').map((li) => li.textContent)).toEqual(NAMES);
    expect(within(box).getByText('and 3 more')).toBeTruthy();
    expect(within(box).getByRole('link', { name: 'See all' }).getAttribute('href')).toBe('/console/iron-house/members?show=agreement-not-signed');
    expect(within(box).getByText('They can still book in the app.')).toBeTruthy();
    // Changed and not saved: See all asks before leaving.
    fireEvent.click(screen.getByRole('radio', { name: 'Stop new bookings until they sign' }));
    expect(within(box).queryByRole('link', { name: 'See all' })).toBeNull();
    fireEvent.click(screen.getByRole('radio', { name: 'Let them book' }));
    expect(within(box).getByRole('link', { name: 'See all' })).toBeTruthy();
    const save = screen.getByRole('button', { name: 'Save' });
    expect(save.disabled).toBe(true);
    fireEvent.click(screen.getByRole('radio', { name: 'Stop new bookings until they sign' }));
    expect(within(box).getByText("Once you save, they can't book classes or personal training in the app until they sign.")).toBeTruthy();
    fireEvent.click(save);
    await waitFor(() => expect(orgService.setAgreementBookings).toHaveBeenCalledWith(ORG.id, 'stop'));
    expect(await screen.findByText('Saved.')).toBeTruthy();
    expect(within(box).getByText("They can't book classes or personal training in the app until they sign.")).toBeTruthy();
  });

  it('nobody has one to sign: it says so; a reader who does not see Members sees no names', async () => {
    orgService.getAgreementBookings.mockResolvedValueOnce({ data: { rule: 'stop', inUse: true, stopped: { count: 0, people: [] } } });
    open(IN_USE);
    expect(await screen.findByText('Nobody on your list has a membership agreement to sign today.')).toBeTruthy();
    cleanup();
    orgService.getAgreementBookings.mockResolvedValueOnce({ data: { rule: 'stop', inUse: true, stopped: null } });
    open(IN_USE);
    expect(await screen.findByText('Before they book')).toBeTruthy();
    expect(screen.queryByRole('group', { name: 'Who has a membership agreement to sign today' })).toBeNull();
  });

  it('counts its staff as Members does, and says the choice never stops them', async () => {
    orgService.getAgreementBookings.mockResolvedValueOnce({ data: { rule: 'stop', inUse: true, stopped: { ...STOPPED, staff: 1 } } });
    open(IN_USE);
    expect(await screen.findByText('Today 8 people on your list have a membership agreement to sign:')).toBeTruthy();
    expect(screen.getByText("Except your staff, they can't book classes or personal training in the app until they sign.")).toBeTruthy();
    cleanup();
    orgService.getAgreementBookings.mockResolvedValueOnce({ data: { rule: 'stop', inUse: true, stopped: { count: 1, staff: 1, people: [{ entryId: bid(9), name: 'Kim Coach' }] } } });
    open(IN_USE);
    expect(await screen.findByText('They are your staff, so they can still book.')).toBeTruthy();
  });

  it('a business with no agreement in use is not asked', async () => {
    open(NONE);
    expect(await screen.findByText('Not set up')).toBeTruthy();
    expect(screen.queryByText('Before they book')).toBeNull();
    expect(orgService.getAgreementBookings).not.toHaveBeenCalled();
  });
});
