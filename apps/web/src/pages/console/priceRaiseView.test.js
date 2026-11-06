// Raise the price for members already on a line (ROADMAP 18w): the question, what Save sends, and a person's page
// line, from the server's answers.
import { describe, expect, it } from 'vitest';
import { priceRaiseLine, raiseBody, raiseBox, raisedNote, raiseProblem, RAISE_DRAFT } from './priceRaiseView';

const ANA = '66666666-6666-4666-8666-000000000001';
const BEN = '66666666-6666-4666-8666-000000000002';
const status = (state, over = {}) => ({ state, fromMinor: 2500, toMinor: 3000, startsOn: '2026-12-03', on: '2026-11-26', ...over });
const person = (membershipId, name, s) => ({ membershipId, entryId: ANA, name, paidBy: null, status: s });
const draft = (over = {}) => ({ id: 'line', choice: 'recurring', price: '30.00', ...RAISE_DRAFT, savedPriceMinor: 2500, ...over });
const offered = (people, over = {}) => draft({ raiseOffer: { key: '3000|30', currency: 'USD', people, failed: false }, ...over });

describe('the question under a higher price', () => {
  it('is asked only of a saved repeating line whose price goes up, with somebody on it', () => {
    expect(raiseProblem(draft({ price: '25.00' }), 'USD')).toBeNull();
    expect(raiseProblem(draft({ id: null }), 'USD')).toBeNull();
    expect(raiseProblem(draft({ choice: 'pack' }), 'USD')).toBeNull();
    expect(raiseProblem(offered([]), 'USD')).toBeNull();
    expect(raiseProblem(offered([person(ANA, 'Ana', status('will_send'))]), 'USD')).toBe('Choose what the members already on it pay.');
  });

  it('Move them with nobody ticked, or before the list has loaded, is refused', () => {
    const people = [person(ANA, 'Ana', status('will_send'))];
    expect(raiseProblem(offered(people, { raiseChoice: 'raise', raiseUnticked: [ANA] }), 'USD')).toBe('Tick at least one member, or choose Keep their price.');
    expect(raiseProblem(draft({ raiseChoice: 'raise' }), 'USD')).toBe('Wait a moment: the list of members on it is still loading.');
    // An answer for another price is never used.
    expect(raiseProblem(offered(people, { raiseChoice: 'raise', price: '31.00' }), 'USD')).toBe('Wait a moment: the list of members on it is still loading.');
  });
});

describe('what Save sends', () => {
  it('only those who go up and are still ticked; nothing for Keep their price', () => {
    const people = [person(ANA, 'Ana', status('will_send')), person(BEN, 'Ben', status('after_freeze')), person('x', 'Nell', status('no_email'))];
    expect(raiseBody(offered(people, { raiseChoice: 'raise' }), 'USD')).toEqual({ raise: { noticeDays: 30, membershipIds: [ANA, BEN] } });
    expect(raiseBody(offered(people, { raiseChoice: 'raise', raiseUnticked: [BEN] }), 'USD')).toEqual({ raise: { noticeDays: 30, membershipIds: [ANA] } });
    expect(raiseBody(offered(people, { raiseChoice: 'keep' }), 'USD')).toEqual({});
  });

  it('the box: who pays the new price, ticked, then who won\'t with the reason', () => {
    const people = [person(ANA, 'Ana', status('will_send')), person(BEN, 'Ben', status('raise_waiting', { toMinor: 2800 }))];
    const box = raiseBox(offered(people, { raiseChoice: 'raise' }), 'USD');
    expect(box.groups.map((g) => [g.title, g.people.map((p) => [p.line, p.ticked])])).toEqual([
      ['Pays the new price (1)', [['Ana · $25.00 to $30.00 from 3 Dec · emailed 26 Nov', true]]],
      ["Won't change: already told of a new price (1)", [['Ben · $28.00 from 3 Dec', null]]],
    ]);
  });

  it('the done line', () => {
    expect(raisedNote(2, 7)).toBe('Saved. 2 members pay the new price from their first payment at least 7 days away, and each is emailed 7 days before it.');
    expect(raisedNote(0, 7)).toBe('Saved. Nobody already on it pays the new price.');
  });
});

describe("a person's page", () => {
  it('says each state in a whole sentence', () => {
    const line = (state, over) => priceRaiseLine(status(state, over), 'USD');
    expect(line('will_send')).toBe('Price goes up to $30.00 from the payment on 3 Dec. The notice is emailed on 26 Nov.');
    expect(line('after_freeze')).toBe('Price goes up to $30.00 once it is back from its freeze. The notice is emailed first.');
    expect(line('sending')).toBe('Price goes up to $30.00 from the payment on 3 Dec. The notice is being emailed.');
    expect(line('sent')).toBe('Price goes up to $30.00 from the payment on 3 Dec. Notice emailed on 26 Nov.');
    expect(line('not_renewing')).toBe("Price stays $25.00: it won't renew before the new price would start.");
    expect(line('address_blocked')).toBe('Price stays $25.00: the notice could not be delivered to their email address.');
    expect(line('not_sent')).toBe('Price stays $25.00 for now: the notice could not be delivered. It is tried again tomorrow.');
    expect(line('maybe_sent')).toBe("Price stays $25.00: we couldn't tell whether the notice was emailed.");
    expect(line('former_payer')).toBe('Price stays $25.00: whoever pays for it is a past member.');
    expect(line('billed_elsewhere')).toBe('Price stays $25.00: it is paid in your other software.');
  });
});
