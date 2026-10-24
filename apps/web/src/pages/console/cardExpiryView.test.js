// What the Bills box lists under the reminder's tick, and Card on file's line (ROADMAP 18d-iii-c).
import { describe, expect, it } from 'vitest';
import { CARD_EXPIRY_WORDS, cardExpiryBox, cardReminderLine, monthWords } from './cardExpiryView';

const person = (name, outcome, on = null) => ({ entryId: `00000000-0000-4000-8000-${name.padStart(12, '0').slice(-12)}`, name, brand: 'MASTERCARD', last4: '4444', outcome, on });

describe('the reminder before a card expires', () => {
  it('says when it is sent: in the month the card expires, up to the 25th, not only on the 1st', () => {
    expect(CARD_EXPIRY_WORDS.hint).toBe(
      'Emailed in the month a card expires: on the 1st, or on the day you turn this on or the card is saved, up to the 25th. It goes to whoever pays with it for a membership that renews, and asks them to give you their new card at the front desk.',
    );
  });

  it('names the month', () => {
    expect(monthWords('2026-01')).toBe('January 2026');
    expect(monthWords('2027-12')).toBe('December 2027');
  });

  it('lists nothing until it is ticked, then every outcome in order, with the day each was emailed', () => {
    const preview = {
      month: '2026-11',
      people: [
        person('Bo', 'not_sent'),
        person('Ann', 'emailed', '2026-11-01'),
        person('Cy', 'not_renewing'),
        person('Di', 'no_email'),
        person('Ed', 'will_email'),
        person('Fay', 'sending'),
        person('', 'will_email'),
        person('Gil', 'maybe_emailed'),
        person('Hal', 'too_late'),
      ],
    };
    expect(cardExpiryBox(preview, { on: false, ticked: false })).toBeNull();
    expect(cardExpiryBox(null, { on: true, ticked: true })).toBeNull();
    const box = cardExpiryBox(preview, { on: true, ticked: true });
    expect(box.heading).toBe('Saved cards that expire in November 2026');
    expect(box.empty).toBeNull();
    expect(box.groups.map((g) => g.title)).toEqual([
      'Emailed (1)',
      'May have been emailed: the email service did not confirm it (1)',
      'Being sent (1)',
      'Will be emailed today (2)',
      'Not emailed: no email address on their record (1)',
      'Not emailed: their card pays for no membership that renews (1)',
      'Not emailed: the email could not be delivered (1)',
      'Not emailed: too close to the end of the month (1)',
    ]);
    expect(box.groups[0].people[0].line).toBe('Ann · Mastercard ending 4444 · 1 Nov');
    expect(box.groups[3].people.map((p) => p.line)).toEqual(['Ed · Mastercard ending 4444', 'Somebody on your list · Mastercard ending 4444']);
    expect(cardExpiryBox(preview, { on: false, ticked: true }).groups[3].title).toBe('Will be emailed once you save (2)');
  });

  it('says so when no saved card expires this month', () => {
    expect(cardExpiryBox({ month: '2026-02', people: [] }, { on: true, ticked: true })).toEqual({
      heading: 'Saved cards that expire in February 2026',
      empty: 'No saved cards expire in February 2026.',
      groups: [],
    });
  });

  it("Card on file says what became of the reminder, only in the card's last month", () => {
    const card = { expiresThisMonth: true, expiryReminder: 'emailed', expiryReminderOn: '2026-11-01' };
    expect(cardReminderLine(card)).toBe('Expiry reminder emailed on 1 Nov.');
    expect(cardReminderLine({ ...card, expiryReminder: 'sending' })).toBe('Expiry reminder being sent.');
    expect(cardReminderLine({ ...card, expiryReminder: 'maybe_emailed' })).toBe('The expiry reminder may have been emailed: the email service did not confirm it.');
    expect(cardReminderLine({ ...card, expiryReminder: 'no_email' })).toBe('No expiry reminder was sent: there is no email address on their record.');
    expect(cardReminderLine({ ...card, expiryReminder: 'not_sent' })).toBe('The expiry reminder could not be delivered.');
    expect(cardReminderLine({ ...card, expiryReminder: null })).toBeNull();
    expect(cardReminderLine({ ...card, expiresThisMonth: false })).toBeNull();
    expect(cardReminderLine(null)).toBeNull();
  });
});
