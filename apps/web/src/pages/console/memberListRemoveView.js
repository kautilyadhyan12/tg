// The words of the Remove box (spec Part 3 §18.6; ROADMAP 5b-v-b-ii), from the server's box:
// who moves to past members, who loses the app, and who doesn't change and why. Three doors:
// 'list' (members ticked on Your list), 'past' (past members ticked) and 'app' (people ticked
// on In the app). Every number is the server's.

const count = (n) => n.toLocaleString('en');

/** "1 member", "3 members". */
const peopleCount = (n, words) => `${count(n)} ${n === 1 ? words.person : words.people}`;

/** How many names a group shows before "and N more". */
export const REMOVE_NAMES_SHOWN = 5;

/** How many names "See all" shows at a time. */
export const REMOVE_NAMES_PAGE = 100;

/** The box's title. */
export function removeTitle(door, words) {
  if (door === 'past') return `Remove past ${words.people} from the app`;
  if (door === 'app') return 'Remove from the app';
  return `Remove ${words.people}`;
}

/** "You selected 4 members." */
export function removeSelectedLine(preview, door, words) {
  const n = preview.selected;
  if (door === 'past') return `You selected ${count(n)} past ${n === 1 ? words.person : words.people}.`;
  if (door === 'app') return `You selected ${count(n)} ${n === 1 ? 'person' : 'people'} in the app.`;
  return `You selected ${peopleCount(n, words)}.`;
}

/** The two groups that change, each a heading and the line under it. */
export function removeChangeGroups(preview, words, gymName) {
  const groups = [];
  if (preview.move.length > 0) {
    groups.push({
      key: 'move',
      heading: `${count(preview.move.length)} will move to past ${words.people}`,
      line: 'Their details are kept, and you can put them back at any time.',
      people: preview.move,
    });
  }
  if (preview.endApp.length > 0) {
    groups.push({
      key: 'endApp',
      heading: `${count(preview.endApp.length)} will lose access to the app`,
      line: `They keep their own workouts and the free app. The app tells them they're no longer a ${words.person} of ${gymName}.`,
      people: preview.endApp,
    });
  }
  return groups;
}

const KEPT_LINES = {
  staff: () => 'Owner and staff keep the app. Manage staff in Settings.',
  own_record: () => "Keep the app: they're on your list with their own details.",
  shared_email: () => "Keep the app: they share an email address with someone still on your list, so we can't tell whose it is.",
  not_in_app: () => "Not in the app, so there's nothing to remove.",
  gone: (words, door) => (door === 'app' ? 'No longer in the app.' : 'No longer on your list.'),
};

/** Who doesn't change: "3 won't change", then a line for each reason with its people. */
export function removeKept(preview, words, door) {
  const total = preview.kept.reduce((sum, group) => sum + group.people.length, 0);
  return {
    heading: total === 0 ? null : `${count(total)} won't change`,
    groups: preview.kept.map((group) => ({
      key: group.reason,
      line: KEPT_LINES[group.reason](words, door),
      // Someone no longer on the list has no name left to show; the line and count say it.
      people: group.reason === 'gone' ? [] : group.people,
      count: group.people.length,
    })),
  };
}

/** The tick a big removal needs, or null. */
export function removeLargeWords(preview, words) {
  const large = preview.large;
  if (large === null) return null;
  if (large.kind === 'app') return `Yes, remove ${count(large.removing)} of your ${count(large.of)} ${words.people} in the app.`;
  return `Yes, move ${count(large.removing)} of your ${count(large.of)} ${words.people} to past ${words.people}.`;
}

/** The red button, or null when nobody selected can be removed. */
export function removeButton(preview, door, words) {
  if (preview.move.length === 0 && preview.endApp.length === 0) return null;
  if (door === 'list') {
    const n = preview.move.length > 0 ? preview.move.length : preview.endApp.length;
    return `Remove ${peopleCount(n, words)}`;
  }
  return `Remove ${count(preview.endApp.length)} from the app`;
}

/** What the box says once it is done. */
export function removeDoneLine(removed, door, words) {
  if (removed.alreadyRemoved) return `These ${words.people} were already removed.`;
  const moved = `${peopleCount(removed.moved, words)} moved to past ${words.people}.`;
  const ended = `${count(removed.endedApp)} ${removed.endedApp === 1 ? 'person' : 'people'} lost access to the app.`;
  if (door === 'list') return removed.endedApp > 0 ? `${moved} ${ended}` : moved;
  const out = `${count(removed.endedApp)} removed from the app.`;
  return removed.moved > 0 ? `${out} ${moved}` : out;
}

/** The names a group shows: the first few, or with "See all", a page more at a time. */
export function namesShown(people, shown) {
  const list = people.slice(0, shown);
  return { list, more: people.length - list.length };
}
