// Card on file, on a person's page (spec Part 3 §14.5; ROADMAP 18d-ii).
//
// THE WORST THING THIS BOX COULD DO: save a card on somebody other than the person whose page
// it is, or without their tick. So the first test: Save card sends this page's own record, only
// once the box is ticked, with the words the person read; and a late answer for a person opened
// earlier is never drawn.
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { act, render, screen, waitFor, cleanup, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { cardAgreementWords } from '@app/shared';

vi.mock('../../api/orgsApi', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    orgService: { getMemberCard: vi.fn(), saveMemberCard: vi.fn(), removeMemberCard: vi.fn() },
  };
});
vi.mock('./squareCard', () => ({ attachCardForm: vi.fn(), tokenizeToSave: vi.fn() }));

const { orgService } = await import('../../api/orgsApi');
const square = await import('./squareCard');
const MemberCard = (await import('./MemberCard')).default;

const GYM = '11111111-1111-4111-8111-111111111111';
const TARA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ZED = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const PRIYA = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const IRON = { name: 'Iron House', slug: 'iron-house', timezone: 'Europe/London', privileges: ['members.confirm', 'billing.members'] };
const OWNER = { ...IRON, privileges: [...IRON.privileges, 'org.manage'] };
const FORM = {
  environment: 'sandbox',
  applicationId: 'sandbox-sq0idb-CONSOLETESTAPP',
  locationId: 'LIRONHOUSE',
  contact: { givenName: 'Tara', familyName: 'Singh', email: 'tara@example.com', countryCode: 'GB' },
};
const VISA = { brand: 'VISA', last4: '1111', expMonth: 12, expYear: 2028, expired: false, savedAt: '2026-10-20T10:00:00.000Z', savedFrom: 'desk' };

const viewOf = (over = {}) => ({
  state: 'ready',
  card: null,
  paidBy: null,
  inApp: false,
  canChange: true,
  isOwner: false,
  gymName: 'Iron House',
  agreement: cardAgreementWords('Iron House'),
  form: FORM,
  ...over,
});
const answer = (over) => Promise.resolve({ data: { cardOnFile: viewOf(over) } });

const fakeCard = { destroy: vi.fn(() => Promise.resolve(true)) };

function show(props = {}) {
  return render(
    <MemoryRouter>
      <MemberCard gymId={GYM} gym={IRON} entryId={TARA} name="Tara Singh" readOnly={false} {...props} />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.mocked(square.attachCardForm).mockResolvedValue(fakeCard);
  vi.mocked(square.tokenizeToSave).mockResolvedValue('cnon:typed-on-squares-form');
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('Card on file: the worst thing', () => {
  it("Save card saves on this page's own person, only once they tick the box, with the words they read", async () => {
    orgService.getMemberCard.mockReturnValue(answer());
    orgService.saveMemberCard.mockReturnValue(answer({ card: VISA }));
    show();
    fireEvent.click(await screen.findByRole('button', { name: 'Add card' }));
    expect(await screen.findByText('Add a card for Tara Singh')).toBeTruthy();
    await waitFor(() => expect(square.attachCardForm).toHaveBeenCalledWith(FORM, screen.getByTestId('square-card-boxes')));
    expect(screen.getByText('Tara reads and ticks this box.')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Save card' }));
    expect((await screen.findByRole('alert')).textContent).toBe('The box must be ticked to agree before the card is saved.');
    expect(square.tokenizeToSave).not.toHaveBeenCalled();
    expect(orgService.saveMemberCard).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('checkbox', { name: cardAgreementWords('Iron House') }));
    fireEvent.click(screen.getByRole('button', { name: 'Save card' }));
    await waitFor(() => expect(orgService.saveMemberCard).toHaveBeenCalledTimes(1));
    const [gymId, entryId, body] = orgService.saveMemberCard.mock.calls[0];
    expect([gymId, entryId]).toEqual([GYM, TARA]);
    expect(body).toEqual({ sourceId: 'cnon:typed-on-squares-form', agreed: true, agreement: cardAgreementWords('Iron House'), requestKey: expect.stringMatching(/^[0-9a-f-]{36}$/) });
    expect(square.tokenizeToSave).toHaveBeenCalledWith(fakeCard, FORM.contact);
    expect((await screen.findByRole('status')).textContent).toBe('Card saved: Visa ending 1111.');
    expect(screen.getByText('Card on file: Visa ending 1111 · expires 12/2028')).toBeTruthy();
    expect(screen.queryByTestId('card-form')).toBeNull();
  });

  it("an answer for a person opened earlier is never drawn on the next person's page", async () => {
    let late;
    orgService.getMemberCard.mockImplementation((_, entryId) => (entryId === TARA ? new Promise((resolve) => (late = resolve)) : answer({ card: null })));
    const { rerender } = show();
    rerender(
      <MemoryRouter>
        <MemberCard gymId={GYM} gym={IRON} entryId={ZED} name="Zed Jones" readOnly={false} />
      </MemoryRouter>,
    );
    expect(await screen.findByText('No card on file')).toBeTruthy();
    await act(async () => late({ data: { cardOnFile: viewOf({ card: VISA }) } }));
    expect(screen.queryByText(/Visa ending 1111/)).toBeNull();
  });
});

describe('Card on file: what it says', () => {
  it("shows nothing for a gym outside Square's countries", async () => {
    orgService.getMemberCard.mockReturnValue(answer({ state: 'not_offered', form: null, canChange: false }));
    const { container } = show();
    await waitFor(() => expect(orgService.getMemberCard).toHaveBeenCalled());
    await act(async () => undefined);
    expect(container.textContent).toBe('');
  });

  it('not connected: the owner gets the button to Square in Settings, everybody else who can', async () => {
    orgService.getMemberCard.mockReturnValue(answer({ state: 'connect', form: null, canChange: false, isOwner: true }));
    show({ gym: OWNER });
    const link = await screen.findByRole('link', { name: 'Connect Square' });
    expect(link.getAttribute('href')).toBe('/console/iron-house/settings#payments');
    expect(screen.getByText('Connect Square to save a card.')).toBeTruthy();
    cleanup();

    orgService.getMemberCard.mockReturnValue(answer({ state: 'connect', form: null, canChange: false, isOwner: false }));
    show();
    expect(await screen.findByText('Only the owner of Iron House can connect Square.')).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Connect Square' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Add card' })).toBeNull();
    cleanup();

    orgService.getMemberCard.mockReturnValue(answer({ state: 'choose_location', form: null, canChange: false, isOwner: true }));
    show({ gym: OWNER });
    expect((await screen.findByRole('link', { name: 'Choose location' })).getAttribute('href')).toBe('/console/iron-house/settings#payments');
  });

  it("somebody paid for by another person: that person's card is used, with a button to their page", async () => {
    orgService.getMemberCard.mockReturnValue(answer({ paidBy: { entryId: PRIYA, name: 'Priya Sharma' }, form: null }));
    show({ name: 'Aarav Sharma' });
    expect(await screen.findByText("Priya Sharma pays for Aarav Sharma, so Priya Sharma's card is used.")).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Open Priya Sharma' }).getAttribute('href')).toBe(`/console/iron-house/members?person=${PRIYA}`);
    expect(screen.queryByRole('button', { name: 'Add card' })).toBeNull();
    expect(screen.queryByText('No card on file')).toBeNull();
  });

  it('no card, in the app: says they can add one there', async () => {
    orgService.getMemberCard.mockReturnValue(answer({ inApp: true }));
    show();
    expect(await screen.findByText('No card on file')).toBeTruthy();
    expect(screen.getByText('Tara can add a card in the app.')).toBeTruthy();
  });

  it('a card on file: Replace card names the card it replaces, and Remove asks first and says what it did', async () => {
    orgService.getMemberCard.mockReturnValue(answer({ card: { ...VISA, expMonth: 4, expYear: 2025, expired: true } }));
    orgService.removeMemberCard.mockReturnValue(answer({ card: null }));
    show();
    expect(await screen.findByText('Card on file: Visa ending 1111 · expired 04/2025')).toBeTruthy();
    expect(screen.getByText('Expired')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Replace card' }));
    expect(await screen.findByText('Replace Visa ending 1111')).toBeTruthy();
    expect(screen.getByText('The new card takes the place of Visa ending 1111.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));

    fireEvent.click(screen.getByRole('button', { name: 'Remove card' }));
    expect(await screen.findByText('Remove Visa ending 1111 from Tara Singh?')).toBeTruthy();
    expect(screen.getByText("Iron House can't charge this card after it's removed. You can add a card again at any time.")).toBeTruthy();
    expect(orgService.removeMemberCard).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Remove card' }));
    await waitFor(() => expect(orgService.removeMemberCard).toHaveBeenCalledWith(GYM, TARA));
    expect((await screen.findByRole('status')).textContent).toBe('Card removed: Visa ending 1111.');
    expect(screen.getByText('No card on file')).toBeTruthy();
  });

  it("Square's form that does not load says so, and Save card waits for it", async () => {
    orgService.getMemberCard.mockReturnValue(answer());
    vi.mocked(square.attachCardForm).mockRejectedValue(new Error('Square did not load'));
    show();
    fireEvent.click(await screen.findByRole('button', { name: 'Add card' }));
    expect((await screen.findByRole('alert')).textContent).toBe("Square's card form didn't load. Check your internet connection, then try again.");
    expect(screen.getByRole('button', { name: 'Save card' }).hasAttribute('disabled')).toBe(true);
  });

  it("Square's refusal is said in the box, and nothing is drawn as saved", async () => {
    orgService.getMemberCard.mockReturnValue(answer());
    orgService.saveMemberCard.mockRejectedValue({ response: { status: 409, data: { error: 'card_declined', message: "The bank didn't accept this card. Try another card." } } });
    show();
    fireEvent.click(await screen.findByRole('button', { name: 'Add card' }));
    await waitFor(() => expect(square.attachCardForm).toHaveBeenCalled());
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'Save card' }));
    expect((await screen.findByRole('alert')).textContent).toBe("The bank didn't accept this card. Try another card.");
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('a read-only console shows the card and no buttons', async () => {
    orgService.getMemberCard.mockReturnValue(answer({ card: VISA }));
    show({ readOnly: true });
    expect(await screen.findByText('Card on file: Visa ending 1111 · expires 12/2028')).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
  });
});
