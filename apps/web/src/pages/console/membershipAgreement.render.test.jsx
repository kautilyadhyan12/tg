// The membership agreement under one membership on a person's page (ROADMAP 18u-i).
//
// The worst thing this box could do: have somebody sign details or words they were not shown.
// So it sends back the key of the details on screen and the wording's id, and changed details
// or words are read again, with the tick to press again, before anything is signed.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

vi.mock('../../api/orgsApi', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, orgService: { getMembershipAgreement: vi.fn(), signMembershipAgreement: vi.fn(), emailAgreementCopy: vi.fn() } };
});

const { orgService } = await import('../../api/orgsApi');
const MembershipAgreement = (await import('./MembershipAgreement')).default;

const GYM = '11111111-1111-4111-8111-111111111111';
const MAYA = '22222222-2222-4222-8222-222222222222';
const GOLD = { id: '33333333-3333-4333-8333-333333333333', agreement: null, view: { status: 'active' } };
const KEY = 'a'.repeat(64);
const AGREEMENT = { id: '44444444-4444-4444-8444-444444444444', version: 2, text: 'Cancel at the front desk with 30 days notice.' };
const FACTS = [
  { label: 'Business', value: 'Iron House' },
  { label: 'Membership', value: 'Gold Monthly' },
  { label: 'Price', value: '$50.00 every month' },
];
const BOX = { gymName: 'Iron House', personName: 'Maya Patel', timezone: 'America/Chicago', minor: false, agreement: AGREEMENT, facts: FACTS, factsKey: KEY, signed: null, hasEmail: true };
const SIGNED = { name: 'Maya Patel', signer: 'person', at: '2026-10-15T17:00:00.000Z', by: 'Ana Owner', version: 2, text: AGREEMENT.text, facts: FACTS, emailedAt: '2026-10-15T17:00:01.000Z' };
const when = () => '15 October 2026';

function draw(props = {}) {
  const handlers = { onOpen: vi.fn(), onClose: vi.fn(), onSigned: vi.fn() };
  const view = render(
    <MembershipAgreement gymId={GYM} entryId={MAYA} membership={GOLD} inUse signable readOnly={false} open={false} justGiven={false} when={when} {...handlers} {...props} />,
  );
  return { ...handlers, ...view };
}

const typeAndTick = (name = 'Maya Patel') => {
  fireEvent.change(screen.getByLabelText('Your full name'), { target: { value: name } });
  fireEvent.click(screen.getByRole('checkbox', { name: 'I have read this agreement and I agree to it.' }));
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('the line under a membership', () => {
  it('says the agreement is not signed, with Sign agreement, where the business asks for one', () => {
    const { onOpen } = draw();
    expect(screen.getByText('Agreement not signed')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Sign agreement' }));
    expect(onOpen).toHaveBeenCalled();
  });

  it('says when it was signed, with View', () => {
    draw({ membership: { ...GOLD, agreement: { at: SIGNED.at } } });
    expect(screen.getByText('Agreement signed')).toBeTruthy();
    expect(screen.getByText('on 15 October 2026')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'View' })).toBeTruthy();
  });

  it('says nothing where the business asks for none, or the membership is over and was never signed', () => {
    draw({ inUse: false });
    expect(screen.queryByTestId('held-agreement')).toBeNull();
    cleanup();
    draw({ signable: false });
    expect(screen.queryByTestId('held-agreement')).toBeNull();
  });
});

describe('signing at the desk', () => {
  it('shows the details and the terms, waits for the name and the tick, and sends back the wording and the key of the details it showed', async () => {
    orgService.getMembershipAgreement.mockResolvedValue({ data: BOX });
    orgService.signMembershipAgreement.mockResolvedValue({ data: { signed: SIGNED, emailed: 'sent' } });
    const { onSigned } = draw({ open: true, justGiven: true });
    expect(await screen.findByText('Hand this screen to Maya Patel. They read the agreement and sign it themselves.')).toBeTruthy();
    expect(screen.getByText('$50.00 every month')).toBeTruthy();
    expect(screen.getByRole('region', { name: "Iron House's terms" }).textContent).toBe(AGREEMENT.text);
    // Sign later, never Cancel, for one just given.
    expect(screen.getByRole('button', { name: 'Sign later' })).toBeTruthy();
    const signButton = screen.getByRole('button', { name: 'Sign' });
    expect(signButton.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Your full name'), { target: { value: 'Maya Patel' } });
    expect(signButton.disabled).toBe(true);
    fireEvent.click(screen.getByRole('checkbox', { name: 'I have read this agreement and I agree to it.' }));
    fireEvent.click(signButton);
    await waitFor(() => expect(onSigned).toHaveBeenCalledWith(SIGNED.at));
    expect(orgService.signMembershipAgreement).toHaveBeenCalledWith(GYM, MAYA, GOLD.id, { agreementId: AGREEMENT.id, factsKey: KEY, signer: 'person', name: 'Maya Patel' });
    expect(screen.getByRole('status').textContent).toBe('Signed. A copy was emailed to them.');
  });

  it('changed details are read again and the tick is pressed again: nothing is signed with the old ones', async () => {
    const newKey = 'b'.repeat(64);
    orgService.getMembershipAgreement.mockResolvedValueOnce({ data: BOX }).mockResolvedValueOnce({ data: { ...BOX, facts: [...FACTS, { label: 'Phone', value: '+1 512 555 0199' }], factsKey: newKey } });
    orgService.signMembershipAgreement.mockRejectedValueOnce({ response: { status: 409, data: { error: 'facts_changed', message: 'The details of this membership have changed. Read them again below, then sign.' } } });
    draw({ open: true });
    await screen.findByLabelText('Your full name');
    typeAndTick();
    fireEvent.click(screen.getByRole('button', { name: 'Sign' }));
    expect(await screen.findByText('The details of this membership have changed. Read them again below, then sign.')).toBeTruthy();
    expect(await screen.findByText('+1 512 555 0199')).toBeTruthy();
    expect(screen.getByRole('checkbox', { name: 'I have read this agreement and I agree to it.' }).getAttribute('aria-checked')).toBe('false');
    expect(screen.getByRole('button', { name: 'Sign' }).disabled).toBe(true);
    orgService.signMembershipAgreement.mockResolvedValueOnce({ data: { signed: SIGNED, emailed: 'no_email' } });
    fireEvent.click(screen.getByRole('checkbox', { name: 'I have read this agreement and I agree to it.' }));
    fireEvent.click(screen.getByRole('button', { name: 'Sign' }));
    await waitFor(() => expect(orgService.signMembershipAgreement).toHaveBeenLastCalledWith(GYM, MAYA, GOLD.id, expect.objectContaining({ factsKey: newKey })));
    expect((await screen.findByRole('status')).textContent).toBe('Signed. There is no email address on their record, so no copy was emailed.');
  });

  it('closed by the page and opened again on new words: the name and the tick given to the old ones are gone, and Sign waits', async () => {
    const NEW = { ...AGREEMENT, id: '55555555-5555-4555-8555-555555555555', version: 3, text: 'NEW WORDS: no refunds ever.' };
    orgService.getMembershipAgreement.mockResolvedValueOnce({ data: BOX }).mockResolvedValueOnce({ data: { ...BOX, agreement: NEW, factsKey: 'b'.repeat(64) } });
    const handlers = { onOpen: vi.fn(), onClose: vi.fn(), onSigned: vi.fn() };
    const props = { gymId: GYM, entryId: MAYA, membership: GOLD, inUse: true, signable: true, readOnly: false, justGiven: false, when, ...handlers };
    const { rerender } = render(<MembershipAgreement {...props} open />);
    await screen.findByLabelText('Your full name');
    typeAndTick();
    expect(screen.getByRole('button', { name: 'Sign' }).disabled).toBe(false);
    // The page closes it (another membership's box opened), then opens it again.
    rerender(<MembershipAgreement {...props} open={false} />);
    rerender(<MembershipAgreement {...props} open />);
    expect(await screen.findByText('NEW WORDS: no refunds ever.')).toBeTruthy();
    expect(screen.getByLabelText('Your full name').value).toBe('');
    expect(screen.getByRole('checkbox', { name: 'I have read this agreement and I agree to it.' }).getAttribute('aria-checked')).toBe('false');
    expect(screen.getByRole('button', { name: 'Sign' }).disabled).toBe(true);
    expect(orgService.signMembershipAgreement).not.toHaveBeenCalled();
  });

  it('a child is signed for by a parent or guardian', async () => {
    orgService.getMembershipAgreement.mockResolvedValue({ data: { ...BOX, personName: 'Mia Reyes', minor: true } });
    orgService.signMembershipAgreement.mockResolvedValue({ data: { signed: { ...SIGNED, signer: 'guardian', name: 'Rosa Reyes' }, emailed: 'sent' } });
    draw({ open: true });
    expect(await screen.findByText('Mia Reyes is under 18. Hand this screen to their parent or guardian, who reads the agreement and signs it for them.')).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Parent or guardian's full name"), { target: { value: 'Rosa Reyes' } });
    fireEvent.click(screen.getByRole('checkbox', { name: "I am Mia Reyes's parent or guardian. I have read this agreement and I agree to it for them." }));
    fireEvent.click(screen.getByRole('button', { name: 'Sign' }));
    await waitFor(() => expect(orgService.signMembershipAgreement).toHaveBeenCalledWith(GYM, MAYA, GOLD.id, expect.objectContaining({ signer: 'guardian', name: 'Rosa Reyes' })));
  });

  it('somebody no longer on the list has nothing to sign, and the box says why', async () => {
    orgService.getMembershipAgreement.mockResolvedValue({ data: { ...BOX, facts: null, factsKey: null, past: true } });
    draw({ open: true });
    expect(await screen.findByText('Maya Patel is no longer on your list, so there is nothing to sign.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Sign' })).toBeNull();
  });

  it('a membership that can no longer be signed says so, with Close', async () => {
    orgService.getMembershipAgreement.mockResolvedValue({ data: { ...BOX, facts: null, factsKey: null } });
    const { onClose } = draw({ open: true });
    expect(await screen.findByText("This membership is over, cancelled or frozen, so it can't be signed now.")).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalled();
  });
});

describe('what was signed', () => {
  it('View shows who signed, the details and the terms as signed, and Email a copy sends it again', async () => {
    orgService.getMembershipAgreement.mockResolvedValue({ data: { ...BOX, signed: { ...SIGNED, emailedAt: null } } });
    orgService.emailAgreementCopy.mockResolvedValue({ data: { emailed: 'sent', emailedAt: '2026-10-16T10:00:00.000Z' } });
    draw({ membership: { ...GOLD, agreement: { at: SIGNED.at } }, open: true });
    expect(await screen.findByText('Signed by Maya Patel on 15 October 2026.')).toBeTruthy();
    expect(screen.getByText('Gold Monthly')).toBeTruthy();
    expect(screen.getByText('No copy has been emailed yet.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Sign' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Email a copy' }));
    expect(await screen.findByText('A copy was emailed to them.')).toBeTruthy();
    expect(orgService.emailAgreementCopy).toHaveBeenCalledWith(GYM, MAYA, GOLD.id);
  });

  it('a record with no email address has no Email a copy, and says why', async () => {
    orgService.getMembershipAgreement.mockResolvedValue({ data: { ...BOX, hasEmail: false, signed: { ...SIGNED, emailedAt: null } } });
    draw({ membership: { ...GOLD, agreement: { at: SIGNED.at } }, open: true });
    expect(await screen.findByText('There is no email address on their record, so no copy was emailed.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Email a copy' })).toBeNull();
  });
});
