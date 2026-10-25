// SQUARE POINT OF SALE AS A WAY OF PAYING (ROADMAP 18d-iii-b-ii-a; Kd, 2026-10-25, "one press"). A gym that
// takes payments in Square's own app picks it in Add member, Add membership or Record payment: nothing is
// recorded here, as recording it as well would put the money on the bill twice, and one line says what
// happens next. Where the customer staff pick in Square is linked to the person, the payment comes to their
// page with the bill ticked, for one press of Match; otherwise it waits in Payments to match.

export const SQUARE_APP_METHOD = 'square_app_take';
export const SQUARE_APP_CHOICE = { value: SQUARE_APP_METHOD, label: 'Square Point of Sale' };

/** What happens next, said where Square Point of Sale is picked. `pick`: whom to pick in Square, by name;
 *  null where the payment will wait in Payments to match. */
export function squareAppNext(pick) {
  return pick === null
    ? 'Take the payment in Square Point of Sale. It then waits in Payments to match, where you match it to the bill.'
    : `Take the payment in Square Point of Sale and pick ${pick} as the customer. It then appears on this page with the bill ticked: press Match.`;
}
