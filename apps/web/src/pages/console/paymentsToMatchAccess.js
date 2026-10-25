// Who sees Payments to match (ROADMAP 18d-iii-b-ii-a): staff who keep the list and record payments, as
// Failed payments: Match is Record payment's own step, and the person's page needs both. Its own file,
// as the menu reads it without the page's words. The server refuses anyone else.
export function canMatchPayments(privileges) {
  return Array.isArray(privileges) && privileges.includes('members.confirm') && privileges.includes('billing.members');
}
