// Overview's App payments to review (ROADMAP 18k-vi): who may read it, and each row's words.
import { appPaymentCheckStatus, appPaymentCheckWhat, formatMinor } from '@app/shared';
import { dayWords } from './memberListView';

/** Staff who take payments and keep the member list, as the server gates it: the rows are resolved on the member's page. */
export const canSeeAppPaymentChecks = (privileges) => Array.isArray(privileges) && privileges.includes('billing.members') && privileges.includes('members.confirm');

/** A row's two lines: what it was for, and where it stands, its day written as the member's page writes it. */
export function appPaymentCheckLines(row) {
  return {
    what: appPaymentCheckWhat(row),
    status: appPaymentCheckStatus(row, row.amountMinor === null ? null : formatMinor(row.amountMinor, row.currency), dayWords(row.on)),
  };
}
