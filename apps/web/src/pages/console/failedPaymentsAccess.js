// Who sees Failed payments (ROADMAP 18d-iii-ii-b): staff who read people and record their payments.
// Its own file, as the menu reads it without the page's words. The server refuses anyone else.
export function canSeeFailedPayments(privileges) {
  return Array.isArray(privileges) && privileges.includes('members.read') && privileges.includes('billing.members');
}
