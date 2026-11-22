// The words of Pause and Resume autopay (ROADMAP 18d-iv-f), every case.
import { describe, expect, it } from 'vitest';
import { autopayPauseBox, autopayPausedLine, autopayPausedWords, autopayPayerPausedLine, autopayResumeBox, autopayResumedWords } from './autopayView';

const card = { brand: 'VISA', last4: '1111' };
const people = [
  { name: 'Maya Patel', what: 'Gold Weekly' },
  { name: 'Arun Patel', what: '' },
];
const preview = (over = {}) => ({ pausedOn: null, people, more: 0, card, squareConnected: true, chargebackStops: false, ...over });

describe('Pause', () => {
  it('names the card and each membership, and says the card stays and bills still come due', () => {
    const box = autopayPauseBox(preview());
    expect(box.title).toBe('Pause autopay?');
    expect(box.lead).toBe("Visa ending 1111 won't be charged automatically for:");
    expect(box.people).toEqual(['Maya Patel · Gold Weekly', 'Arun Patel']);
    expect(box.note).toBe('The card stays saved. Bills still come due: take payment at the desk, or charge the card from the bill.');
    expect(box.button).toBe('Pause');
    expect(autopayPausedWords(preview())).toBe('Autopay paused. Visa ending 1111 stays saved.');
  });

  it('nobody with a renewing membership says nothing is charged now', () => {
    expect(autopayPauseBox(preview({ people: [] })).lead).toBe('Nobody this card pays for has a renewing membership, so nothing is charged automatically now.');
  });

  it('the lines', () => {
    expect(autopayPausedLine('2026-11-02')).toBe('Autopay paused on 2 November 2026.');
    expect(autopayPayerPausedLine('Priya Sharma')).toBe("Autopay is paused on Priya Sharma's card.");
  });
});

describe('Resume', () => {
  it('says the card will be charged, and which bills', () => {
    const box = autopayResumeBox(preview({ pausedOn: '2026-11-02' }));
    expect(box.lead).toBe('Visa ending 1111 will be charged automatically for:');
    expect(box.note).toBe('A bill due in the last two days may be charged today. Charge older bills by hand, oldest first.');
    expect(autopayResumedWords(preview())).toBe('Autopay resumed. Visa ending 1111 will be charged when bills are due.');
  });

  it('never says a card will be charged where it will not be', () => {
    const cases = [
      { over: { chargebackStops: true }, lead: 'A chargeback still pauses autopay, so nothing will be charged until it is closed. This applies to:', done: 'Autopay resumed. A chargeback still pauses it until it is closed.' },
      { over: { chargebackStops: true, people: [] }, lead: 'A chargeback still pauses autopay until it is closed.', done: 'Autopay resumed. A chargeback still pauses it until it is closed.' },
      { over: { people: [] }, lead: 'Nobody this card pays for has a renewing membership, so nothing will be charged.', done: 'Autopay resumed. Nobody this card pays for has a renewing membership, so nothing will be charged.' },
      { over: { card: null, squareConnected: false }, lead: 'Square is not connected, so nothing will be charged until it is connected again. This applies to:', done: 'Autopay resumed. Nothing will be charged until Square is connected again.' },
      { over: { card: null }, lead: 'No card is on file, so nothing will be charged until one is added. This applies to:', done: 'Autopay resumed. Nothing will be charged until a card is on file.' },
    ];
    for (const c of cases) {
      const box = autopayResumeBox(preview(c.over));
      expect(box.lead).toBe(c.lead);
      expect(box.note).toBeNull();
      expect(autopayResumedWords(preview(c.over))).toBe(c.done);
    }
  });
});
