// Card on file (ROADMAP 18d-ii): what the box draws for each answer the server gives.
import { describe, expect, it } from 'vitest';
import { cardAgreementWords } from '@app/shared';
import { cardBoxView, cardFormWords, personNames, removeCardWords } from './memberCardView';

const FORM = { environment: 'sandbox', applicationId: 'sandbox-sq0idb-VIEWTESTAPP00', locationId: 'L1', contact: { givenName: 'Tara', familyName: 'Singh', email: null, countryCode: 'GB' } };
const VISA = { brand: 'VISA', last4: '1111', expMonth: 12, expYear: 2028, expired: false, savedAt: '2026-10-20T10:00:00.000Z', savedFrom: 'desk' };
const view = (over = {}) => ({ state: 'ready', card: null, earlierCard: null, paidBy: null, inApp: false, canChange: true, isOwner: false, gymName: 'Iron House', agreement: cardAgreementWords('Iron House'), form: FORM, ...over });

describe('Card on file', () => {
  it("nothing at all outside Square's countries", () => {
    expect(cardBoxView(view({ state: 'not_offered', form: null }), 'Tara Singh')).toBeNull();
    expect(cardBoxView(null, 'Tara Singh')).toBeNull();
  });

  it('ready, no card: Add card, and the app line only for somebody in the app', () => {
    expect(cardBoxView(view(), 'Tara Singh')).toMatchObject({ noneLine: 'No card on file', canAdd: true, canRemove: false, appLine: null, connect: null, ownerOnly: null });
    expect(cardBoxView(view({ inApp: true }), 'Tara Singh').appLine).toBe('Tara can add a card in the app.');
    expect(cardBoxView(view({ inApp: true }), '').appLine).toBe('This person can add a card in the app.');
  });

  it('a card saved with the Square account the gym used before: named, and Add card asks for it again', () => {
    const earlier = { brand: 'MASTERCARD', last4: '4444' };
    expect(cardBoxView(view({ earlierCard: earlier }), 'Tara Singh')).toMatchObject({
      noneLine: 'No card on file',
      earlierLine: 'Mastercard ending 4444 was saved with the Square account Iron House used before. Add the card again.',
      canAdd: true,
    });
    expect(cardBoxView(view({ earlierCard: earlier, state: 'connect', form: null, canChange: false }), 'Tara').earlierLine).toBeNull();
  });

  it('a card: its line, Replace and Remove; a lapsed gym can do neither', () => {
    expect(cardBoxView(view({ card: VISA }), 'Tara Singh')).toMatchObject({ cardLine: 'Card on file: Visa ending 1111 · expires 12/2028', noneLine: null, canAdd: true, canRemove: true });
    expect(cardBoxView(view({ card: VISA, canChange: false, form: null }), 'Tara Singh')).toMatchObject({ canAdd: false, canRemove: false });
  });

  it('not connected, or a location to choose: the owner is sent to Settings, everybody else told who can', () => {
    expect(cardBoxView(view({ state: 'connect', form: null, canChange: false, isOwner: true }), 'T')).toMatchObject({ connect: 'connect', connectLine: 'Connect Square to save a card.', ownerOnly: null, canAdd: false });
    expect(cardBoxView(view({ state: 'choose_location', form: null, canChange: false, isOwner: true }), 'T')).toMatchObject({ connect: 'choose', connectLine: 'Choose your Square location to save a card.' });
    expect(cardBoxView(view({ state: 'connect', form: null, canChange: false }), 'T')).toMatchObject({ connect: null, connectLine: null, ownerOnly: 'Only the owner of Iron House can connect Square.' });
  });

  it("paid for by somebody else: their card is used; the person's own card can still be removed", () => {
    const paid = cardBoxView(view({ paidBy: { entryId: 'p', name: 'Priya Sharma' }, form: null }), 'Aarav Sharma');
    expect(paid).toMatchObject({ canAdd: false, noneLine: null, paidBy: { line: "Priya Sharma pays for Aarav Sharma, so Priya Sharma's card is used.", name: 'Priya Sharma' } });
    expect(cardBoxView(view({ paidBy: { entryId: 'p', name: '' }, card: VISA, form: null }), '').paidBy.line).toBe(
      "Somebody else on your list pays for this person, so Somebody else on your list's card is used.",
    );
    expect(cardBoxView(view({ paidBy: { entryId: 'p', name: 'Priya Sharma' }, card: VISA, form: null }), 'Aarav').canRemove).toBe(true);
  });

  it('the form and Remove name the card and the person', () => {
    expect(cardFormWords(view(), 'Tara Singh')).toEqual({ title: 'Add a card for Tara Singh', detail: null, tickHint: 'Tara reads and ticks this box.' });
    expect(cardFormWords(view({ card: VISA }), 'Tara Singh').title).toBe('Replace Visa ending 1111');
    expect(removeCardWords(view({ card: VISA }), 'Tara Singh').question).toBe('Remove Visa ending 1111 from Tara Singh?');
    expect(personNames('  ')).toEqual({ full: 'this person', first: 'This person' });
  });
});
