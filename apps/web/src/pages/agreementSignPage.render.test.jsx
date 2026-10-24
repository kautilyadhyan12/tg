// The page an emailed link to sign opens (ROADMAP 18u-ii-b).
//
// The worst thing this page could do: have somebody sign details or words they were not shown, or
// sign with a link that no longer works. So it sends back the token, the wording's id and the key of
// the details on screen; changed details or words are read again with the tick to press again, and
// a link the server no longer knows says so instead of a form.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { AGREEMENT_WORDS } from '@app/shared';

vi.mock('../api/agreementLinkApi', () => ({ agreementLinkService: { read: vi.fn(), sign: vi.fn() } }));

const { agreementLinkService } = await import('../api/agreementLinkApi');
const AgreementSignPage = (await import('./AgreementSignPage')).default;
const { linkTokenFromHash } = await import('./agreementLinkView');

const TOKEN = 'A'.repeat(20) + 'b'.repeat(20) + '_-9';
const KEY = 'a'.repeat(64);
const KEY2 = 'b'.repeat(64);
const AGREEMENT = { id: '44444444-4444-4444-8444-444444444444', version: 2, text: 'Cancel with 30 days notice.', name: null };
const FACTS = [
  { label: 'Business', value: 'Iron House' },
  { label: 'Member', value: 'Maya Patel' },
  { label: 'Price', value: '$50.00 every month' },
];
const OPEN = { state: 'open', gymName: 'Iron House', personName: 'Maya Patel', minor: false, agreement: AGREEMENT, facts: FACTS, factsKey: KEY, expiresAt: '2026-10-29T17:00:00.000Z' };
const apiError = (status, error, message) => Object.assign(new Error(error), { response: { status, data: { error, message } } });

const draw = (hash = `#${TOKEN}`) => {
  window.history.replaceState(null, '', `/sign-agreement${hash}`);
  return render(<AgreementSignPage />);
};
const typeAndTick = (label = 'Your full name', name = 'Maya Patel', agree = 'I have read this agreement and I agree to it.') => {
  fireEvent.change(screen.getByLabelText(label), { target: { value: name } });
  fireEvent.click(screen.getByRole('checkbox', { name: agree }));
};

beforeEach(() => {
  vi.clearAllMocks();
});
afterEach(() => {
  cleanup();
});

describe('the token in the link', () => {
  it('is read only in our shape: a link copied without its end, or anything else, is not one', () => {
    expect(linkTokenFromHash(`#${TOKEN}`)).toBe(TOKEN);
    expect(linkTokenFromHash(`#${TOKEN.slice(0, 40)}`)).toBeNull();
    expect(linkTokenFromHash(`#${TOKEN}x`)).toBeNull();
    expect(linkTokenFromHash('#<script>')).toBeNull();
    expect(linkTokenFromHash('')).toBeNull();
  });

  it('says the link is not valid, and asks nothing of the server, where there is no token', () => {
    draw('');
    expect(screen.getByText(AGREEMENT_WORDS.link_not_valid)).toBeTruthy();
    expect(agreementLinkService.read).not.toHaveBeenCalled();
  });

  it("says the link is not valid where the server knows no such link, naming nobody", async () => {
    agreementLinkService.read.mockRejectedValue(apiError(404, 'link_not_valid', AGREEMENT_WORDS.link_not_valid));
    draw();
    expect(await screen.findByText(AGREEMENT_WORDS.link_not_valid)).toBeTruthy();
    expect(screen.queryByRole('textbox')).toBeNull();
  });
});

describe('signing from the link', () => {
  it('shows the details and the terms, waits for the name and the tick, and sends the token with what it showed', async () => {
    agreementLinkService.read.mockResolvedValue(OPEN);
    agreementLinkService.sign.mockResolvedValue({ emailed: 'sent' });
    draw();
    expect(await screen.findByRole('heading', { name: 'Iron House' })).toBeTruthy();
    expect(agreementLinkService.read).toHaveBeenCalledWith(TOKEN);
    expect(screen.getByText('$50.00 every month')).toBeTruthy();
    expect(screen.getByRole('region', { name: "Iron House's terms" }).textContent).toBe(AGREEMENT.text);
    // Never "hand this screen over": the reader is the one signing.
    expect(screen.queryByText(/Hand this screen/)).toBeNull();
    const button = screen.getByRole('button', { name: 'Sign agreement' });
    expect(button.disabled).toBe(true);
    typeAndTick();
    fireEvent.click(button);
    expect(await screen.findByText('A copy has been emailed to you.')).toBeTruthy();
    expect(agreementLinkService.sign).toHaveBeenCalledWith(TOKEN, { agreementId: AGREEMENT.id, factsKey: KEY, signer: 'person', name: 'Maya Patel' });
    expect(screen.queryByRole('button', { name: 'Sign agreement' })).toBeNull();
  });

  it('reads the details again where they changed, and the tick is pressed again for the new ones', async () => {
    agreementLinkService.read.mockResolvedValueOnce(OPEN).mockResolvedValueOnce({ ...OPEN, factsKey: KEY2, facts: [...FACTS.slice(0, 2), { label: 'Price', value: '$55.00 every month' }] });
    agreementLinkService.sign.mockRejectedValueOnce(apiError(409, 'facts_changed', AGREEMENT_WORDS.facts_changed)).mockResolvedValueOnce({ emailed: 'sent' });
    draw();
    await screen.findByText('$50.00 every month');
    typeAndTick();
    fireEvent.click(screen.getByRole('button', { name: 'Sign agreement' }));
    expect(await screen.findByText(AGREEMENT_WORDS.facts_changed)).toBeTruthy();
    expect(await screen.findByText('$55.00 every month')).toBeTruthy();
    expect(screen.getByRole('checkbox').getAttribute('aria-checked')).toBe('false');
    expect(screen.getByRole('button', { name: 'Sign agreement' }).disabled).toBe(true);
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'Sign agreement' }));
    await screen.findByText('A copy has been emailed to you.');
    expect(agreementLinkService.sign).toHaveBeenLastCalledWith(TOKEN, { agreementId: AGREEMENT.id, factsKey: KEY2, signer: 'person', name: 'Maya Patel' });
  });

  it('asks a parent or guardian to sign for somebody under 18', async () => {
    agreementLinkService.read.mockResolvedValue({ ...OPEN, personName: 'Sam Young', minor: true });
    agreementLinkService.sign.mockResolvedValue({ emailed: 'sent' });
    draw();
    expect(await screen.findByText('Sam Young is under 18, so a parent or guardian signs this agreement for them.')).toBeTruthy();
    typeAndTick("Parent or guardian's full name", 'Pat Young', "I am Sam Young's parent or guardian. I have read this agreement and I agree to it for them.");
    fireEvent.click(screen.getByRole('button', { name: 'Sign agreement' }));
    await screen.findByText('A copy has been emailed to you.');
    expect(agreementLinkService.sign).toHaveBeenCalledWith(TOKEN, expect.objectContaining({ signer: 'guardian', name: 'Pat Young' }));
  });

  it('asks who is signing where the record has no date of birth', async () => {
    agreementLinkService.read.mockResolvedValue({ ...OPEN, minor: null });
    draw();
    await screen.findByRole('radiogroup', { name: 'Who is signing?' });
    expect(screen.queryByLabelText('Your full name')).toBeNull();
    fireEvent.click(screen.getByRole('radio', { name: 'Maya Patel' }));
    expect(screen.getByLabelText('Your full name')).toBeTruthy();
  });

  it('says the link has expired where it ran out while the page was open, with no form left', async () => {
    agreementLinkService.read.mockResolvedValue(OPEN);
    agreementLinkService.sign.mockRejectedValue(apiError(410, 'link_expired', AGREEMENT_WORDS.link_expired('Iron House')));
    draw();
    await screen.findByText('$50.00 every month');
    typeAndTick();
    fireEvent.click(screen.getByRole('button', { name: 'Sign agreement' }));
    expect(await screen.findByText(AGREEMENT_WORDS.link_expired('Iron House'))).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Sign agreement' })).toBeNull();
  });
});

describe('a link with nothing to sign', () => {
  it.each([
    [{ state: 'closed', gymName: 'Iron House', reason: 'expired' }, AGREEMENT_WORDS.link_expired('Iron House')],
    [{ state: 'signed', gymName: 'Iron House' }, 'This agreement has already been signed. If you need a copy, ask Iron House.'],
    [{ state: 'closed', gymName: 'Iron House', reason: 'not_in_use' }, AGREEMENT_WORDS.agreement_not_in_use('Iron House')],
    [{ state: 'closed', gymName: 'Iron House', reason: 'not_signable' }, 'This membership is over, cancelled or frozen, so there is nothing to sign. If you have a question, contact Iron House.'],
  ])('%o says so, with no form', async (page, line) => {
    agreementLinkService.read.mockResolvedValue(page);
    draw();
    expect(await screen.findByText(line)).toBeTruthy();
    expect(screen.queryByRole('textbox')).toBeNull();
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Sign agreement' })).toBeNull());
  });
});
