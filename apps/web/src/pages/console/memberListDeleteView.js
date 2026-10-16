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

/** "3 past members deleted permanently." */
export function deleteDoneLine(done, words) {
  return `${pastPeople(done.deleted, words)} deleted permanently.`;
}
