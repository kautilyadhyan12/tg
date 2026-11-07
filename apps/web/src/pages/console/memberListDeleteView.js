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
export const DELETE_WHAT_HAPPENS = 'Their details and history are deleted and can’t be brought back. Payments they made stay in your takings and reports, as “A deleted member”. Waivers signed at the front desk and membership agreements are kept for six years, for the owner, in Settings.';

/** Who is ticked and not deleted, and why; null where everyone ticked is a past member. */
export function deleteKeptLine(preview, words) {
  if (preview.onList === 0) return null;
  const n = preview.onList;
  return `${count(n)} ${n === 1 ? `${words.person} you ticked is` : `${words.people} you ticked are`} on your list, so they aren't deleted. Remove them first.`;
}

/** Why nothing can be deleted, or null where something can. */
export function deleteNobodyLine(preview, words) {
  if (preview.tooMany) return `You can delete up to ${count(MEMBER_LIST_DELETE_MAX)} past ${words.people} at a time. Tick fewer, then delete.`;
  // Everybody ticked still uses the app and this role can't end it: the "Not deleted" group says why.
  if (preview.count === 0 && preview.app?.mayEndApp === false && (preview.app?.ends?.length ?? 0) > 0) return null;
  if (preview.count === 0) return `Nobody you selected can be deleted. Only past ${words.people} can be.`;
  return null;
}

/** "Delete 3 permanently". */
export function deleteButton(preview) {
  return `Delete ${count(preview.count)} permanently`;
}

/** "3 past members deleted permanently. 2 of them are being deleted from your Square customer list too." */
export function deleteDoneLine(done, words) {
  if (done.nothingLeft) return `None of these are past ${words.people} any more, so nothing was deleted.`;
  const deleted = `${pastPeople(done.deleted, words)} deleted permanently.${deletedAppLine(done, words)}`;
  const n = done.squareDeleting ?? 0;
  if (n === 0) return deleted;
  const who = n === done.deleted ? (n === 1 ? 'They are' : 'All of them are') : n === 1 ? 'One of them is' : `${count(n)} of them are`;
  return `${deleted} ${who} being deleted from your Square customer list too.`;
}

// What Delete permanently does about the people in the gym's Square customer list (18d-iii-b-ii-b-ii-b-ii). Square calls everybody it
// holds a customer, and so does its list: a member is in it, added by the app or by the gym itself. The box names every person it says
// something about, one reason for each group.
const SQUARE_GROUPS = [
  {
    key: 'deletes',
    title: (n) => `Also deleted from your Square customer list (${count(n)})`,
    why: 'The app added them to your Square customer list, so they are deleted from it too. One that Square is still charging, or that was changed in Square, stays.',
  },
  {
    key: 'stays',
    title: (n) => `Stay in your Square customer list (${count(n)})`,
    why: 'They are in your Square customer list, but the app didn’t add them, so they stay there.',
  },
  {
    key: 'shared',
    title: (n) => `Also used by somebody else (${count(n)})`,
    why: 'Somebody else also uses them in your Square customer list, so they stay there.',
  },
  {
    key: 'notReached',
    title: (n) => `Can’t be reached in Square (${count(n)})`,
    why: 'The app added them to your Square customer list, but it can’t reach your Square, or needs another permission from it, so they stay there.',
  },
];

/** The groups the box shows under the names, each with its people, its count and its one reason; none for a gym with nobody in Square. */
export function deleteSquareGroups(preview) {
  const square = preview?.square ?? {};
  const names = preview?.squareNames ?? {};
  return SQUARE_GROUPS.filter((g) => (square[g.key] ?? 0) > 0).map((g) => ({
    key: g.key,
    title: g.title(square[g.key]),
    why: g.why,
    total: square[g.key],
    people: (names[g.key] ?? []).map((name, i) => ({ id: `${g.key}-${String(i)}`, name })),
  }));
}

/** Who can open Connect Square, for the group the app cannot reach. */
export const SQUARE_OWNER_ONLY = 'Only the owner can connect Square.';

/** The same on one past member's page, or null where they are not in the Square customer list. */
export function deleteSquareLineOne(kind, name) {
  if (kind === 'deletes') return `${name} is in your Square customer list, added by the app, and is deleted from it too. If Square is still charging them, or they were changed in Square, they stay.`;
  if (kind === 'stays') return `${name} is in your Square customer list, but the app didn’t add them, so they stay there.`;
  if (kind === 'shared') return `${name} is also used by somebody else in your Square customer list, so they stay there.`;
  if (kind === 'not_reached') return `The app can’t reach your Square, or needs another permission from it, so ${name} stays in your Square customer list.`;
  return null;
}

/** " They are also being deleted from your Square customer list." after one person is deleted, or '' where they are not in it. */
export function deletedOneSquareLine(squareDeleting) {
  return squareDeleting > 0 ? ' They are also being deleted from your Square customer list.' : '';
}

// What Delete permanently does about past members still in the app (5e-iii): their access to the gym there ends with their
// record, as Remove from app ends it; staff keep theirs. The box names each, with its reason.
/** The groups under the names; none where nobody deleted is in the app. */
export function deleteAppGroups(preview, words) {
  const app = preview?.app ?? { ends: [], keeps: [], mayEndApp: true };
  const it = words.it ?? 'gym';
  const people = (key, names) => names.map((name, i) => ({ id: `${key}-${String(i)}`, name }));
  const groups = [];
  if (app.ends.length > 0 && app.mayEndApp) {
    groups.push({
      key: 'ends',
      title: `Also lose access to your ${it} in the app (${count(app.ends.length)})`,
      why: `They still use the app, so their access to your ${it} there ends too. Their own accounts and workout history aren’t affected.`,
      total: app.ends.length,
      people: people('ends', app.ends),
    });
  }
  // A role that can't remove app access: these are left out of the delete, and the others are deleted.
  if (app.ends.length > 0 && !app.mayEndApp) {
    groups.push({
      key: 'notDeleted',
      title: `Not deleted (${count(app.ends.length)})`,
      why: `They still use the app, and your role can’t remove their access to your ${it} there, so they aren’t deleted. Ask the owner.`,
      total: app.ends.length,
      people: people('notDeleted', app.ends),
    });
  }
  if (app.keeps.length > 0) {
    groups.push({
      key: 'keeps',
      title: `Keep access in the app (${count(app.keeps.length)})`,
      why: `They are on your staff, so they keep access to your ${it} in the app.`,
      total: app.keeps.length,
      people: people('keeps', app.keeps),
    });
  }
  return groups;
}

/** " 2 of them no longer have access to your gym in the app." after a delete, or '' where nobody deleted was in the app. */
function deletedAppLine(done, words) {
  const n = done.appEnded ?? 0;
  if (n === 0) return '';
  const it = words.it ?? 'gym';
  if (n === done.deleted) return n === 1 ? ` They no longer have access to your ${it} in the app.` : ` None of them have access to your ${it} in the app any more.`;
  return n === 1 ? ` One of them no longer has access to your ${it} in the app.` : ` ${count(n)} of them no longer have access to your ${it} in the app.`;
}

/** On one past member's page, before Delete permanently: whose access ends and who keeps it (5e-iii); null for each nobody. */
export function deleteAppLinesOne({ ending, keeping, mayEndApp, it = 'gym', listNames }) {
  const ends =
    ending.length === 0
      ? null
      : mayEndApp
        ? `${listNames(ending)} will also lose access to your ${it} in the app. ${ending.length === 1 ? 'Their own account and workout history aren’t' : 'Their own accounts and workout history aren’t'} affected.`
        : `${listNames(ending)} still ${ending.length === 1 ? 'uses' : 'use'} the app. Deleting them also removes their access to your ${it} there, which your role can’t do. Ask the owner.`;
  const keeps = keeping.length === 0 ? null : `${listNames(keeping)} ${keeping.length === 1 ? 'is' : 'are'} on your staff, so they keep access to your ${it} in the app.`;
  return { ends, keeps };
}

/** " They no longer have access to your gym in the app." after one person is deleted, or ''. */
export function deletedOneAppLine(appEnded, it = 'gym') {
  return appEnded ? ` They no longer have access to your ${it} in the app.` : '';
}
