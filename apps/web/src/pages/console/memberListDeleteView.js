// The words of the Delete permanently box for the past members selected (5e-ii).
import { MEMBER_LIST_DELETE_MAX } from '@app/shared';

const count = (n) => n.toLocaleString('en');
const pastPeople = (n, words) => `${count(n)} past ${n === 1 ? words.person : words.people}`;

/** "Delete 3 past members permanently?", or null where nobody selected can be deleted. */
export function deleteQuestion(preview, words) {
  if (preview.count === 0 || preview.tooMany) return null;
  return `Delete ${pastPeople(preview.count, words)} permanently?`;
}

/** The line under the names: what deleting does. */
export const DELETE_WHAT_HAPPENS = 'Their details and history are deleted and can’t be brought back. Payments they made stay in your takings and reports, as “A deleted member”.';

/** Who is ticked and not deleted, and why; null where everyone ticked is a past member. */
export function deleteKeptLine(preview, words) {
  if (preview.onList === 0) return null;
  const n = preview.onList;
  return `${count(n)} ${n === 1 ? `${words.person} you ticked is` : `${words.people} you ticked are`} on your list, so they aren't deleted. Remove them first.`;
}

/** Why nothing can be deleted, or null where something can. */
export function deleteNobodyLine(preview, words) {
  if (preview.tooMany) return `You can delete up to ${count(MEMBER_LIST_DELETE_MAX)} past ${words.people} at a time. Tick fewer, then delete.`;
  if (preview.count === 0) return `Nobody you selected can be deleted. Only past ${words.people} can be.`;
  return null;
}

/** "Delete 3 permanently". */
export function deleteButton(preview) {
  return `Delete ${count(preview.count)} permanently`;
}

/** "3 past members deleted permanently. 2 customers are being deleted from your Square customer list." */
export function deleteDoneLine(done, words) {
  if (done.nothingLeft) return `None of these are past ${words.people} any more, so nothing was deleted.`;
  const deleted = `${pastPeople(done.deleted, words)} deleted permanently.`;
  const n = done.squareDeleting ?? 0;
  if (n === 0) return deleted;
  return `${deleted} ${count(n)} ${n === 1 ? 'customer is' : 'customers are'} being deleted from your Square customer list.`;
}

// What Delete permanently does about customers in the gym's Square (18d-iii-b-ii-b-ii-b-ii). `square` is the box's own count of
// the past members it deletes: whose customer the app added (deleted from Square too), whose customer stays (it was already in
// Square, Square merged it, or another record uses it), and whose the app cannot reach.
const CANT_REACH = 'The app can’t reach your Square';

/** The lines under the names, each with a key; none for a gym with nobody in Square. */
export function deleteSquareLines(square) {
  const lines = [];
  const { deletes = 0, stays = 0, notReached = 0 } = square ?? {};
  if (deletes > 0) {
    lines.push({
      key: 'deletes',
      text:
        deletes === 1
          ? 'One of them was added to your Square customer list by the app. That customer is deleted from Square too.'
          : `${count(deletes)} of them were added to your Square customer list by the app. Those customers are deleted from Square too.`,
    });
  }
  if (stays > 0) {
    lines.push({
      key: 'stays',
      text:
        stays === 1
          ? "One of them is linked to a customer that stays in Square, because the app didn’t add it or someone else here also uses it."
          : `${count(stays)} of them are linked to customers that stay in Square, because the app didn’t add them or someone else here also uses them.`,
    });
  }
  if (notReached > 0) {
    lines.push({
      key: 'notReached',
      text:
        notReached === 1
          ? `${CANT_REACH}, so the customer it added for one of them stays there.`
          : `${CANT_REACH}, so the customers it added for ${count(notReached)} of them stay there.`,
    });
  }
  return lines;
}

/** Who can open Connect Square, for the line about customers the app cannot reach. */
export const SQUARE_OWNER_ONLY = 'Only the owner can connect Square.';

/** The same on one past member's page, or null where they have no customer in Square. */
export function deleteSquareLineOne(kind, name) {
  if (kind === 'deletes') return `${name} was added to your Square customer list by the app. That customer is deleted from Square too.`;
  if (kind === 'stays') return `${name} is linked to a customer that stays in Square, because the app didn’t add it or someone else here also uses it.`;
  if (kind === 'not_reached') return `${CANT_REACH}, so the customer it added for ${name} stays there.`;
  return null;
}

/** "Their customer is being deleted from Square." after one person is deleted, or '' where there is none. */
export function deletedOneSquareLine(squareDeleting) {
  return squareDeleting > 0 ? ' Their customer is being deleted from Square.' : '';
}
