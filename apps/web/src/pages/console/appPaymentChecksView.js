// Overview's Payments to check in Square (ROADMAP 18k-vi): who may read it, and each row's words.
import { appPaymentCheckSentence, appPaymentCheckWhat, formatMinor } from '@app/shared';

/** Staff who take payments and keep the member list, as the server gates it: the rows are settled on the member's page. */
export const canSeeAppPaymentChecks = (privileges) => Array.isArray(privileges) && privileges.includes('billing.members') && privileges.includes('members.confirm');

/** A row's two lines: what it was for, and the person's page's own sentence for it. */
export function appPaymentCheckLines(row) {
  return {
    what: appPaymentCheckWhat(row),
    sentence: appPaymentCheckSentence(row, row.amountMinor === null ? null : formatMinor(row.amountMinor, row.currency)),
  };
}
