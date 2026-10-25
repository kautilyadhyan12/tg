// SQUARE POINT OF SALE AS A WAY OF PAYING (ROADMAP 18d-iii-b-ii-a): picked in Add member, Add membership or
// Record payment it records nothing, so the money taken in Square is never on the bill twice, and one line
// says what happens next.
import { describe, expect, it } from 'vitest';
import { giveBody } from './heldMembershipsView';
import { SQUARE_APP_CHOICE, SQUARE_APP_METHOD, squareAppNext } from './squareAppChoice';

const GOLD = { id: '11111111-1111-4111-8111-111111111111', name: 'Gold Weekly', priceMinor: 2500, joiningFeeMinor: 0, termCount: 1, termUnit: 'week', kind: 'recurring', billDay: null };

describe('Square Point of Sale as a way of paying', () => {
  it('is named as Square names its app', () => {
    expect(SQUARE_APP_CHOICE).toEqual({ value: SQUARE_APP_METHOD, label: 'Square Point of Sale' });
  });

  it('says whom to pick where the payment will come to their page, and where it waits otherwise', () => {
    expect(squareAppNext('Jun Ito')).toBe('Take the payment in Square Point of Sale and pick Jun Ito as the customer. It then appears on this page with the bill ticked: press Match.');
    expect(squareAppNext(null)).toBe('Take the payment in Square Point of Sale. It then waits in Payments to match, where you match it to the bill.');
  });

  it('a membership given with it is given unpaid, with no way of paying recorded', () => {
    const body = giveBody('k-1', GOLD, { typeId: GOLD.id, startsOn: '2026-10-26', paid: true, method: SQUARE_APP_METHOD });
    expect(body.paid).toBe(false);
    expect(body).not.toHaveProperty('method');
    // Any other way is recorded as before.
    expect(giveBody('k-2', GOLD, { typeId: GOLD.id, startsOn: '2026-10-26', paid: true, method: 'cash' })).toMatchObject({ paid: true, method: 'cash' });
  });
});
