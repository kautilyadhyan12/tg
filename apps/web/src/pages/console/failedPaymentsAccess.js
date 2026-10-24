// Who sees Failed payments (ROADMAP 18d-iii-ii-b): staff who keep the list and record payments, the
// two ticks Try again and the person's page need. Its own file, as the menu reads it without the
// page's words. The server refuses anyone else.
export function canSeeFailedPayments(privileges) {
  return Array.isArray(privileges) && privileges.includes('members.confirm') && privileges.includes('billing.members');
}
