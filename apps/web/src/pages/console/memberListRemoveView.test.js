// The Remove box's words (spec Part 3 §18.6; ROADMAP 5b-v-b-ii), for each door and count.
import { describe, expect, it } from 'vitest';
import {
  namesShown,
  removeButton,
  removeChangeGroups,
  removeDoneLine,
  removeKept,
  removeLargeWords,
  removeSelectedLine,
  removeTitle,
} from './memberListRemoveView';

const GYM = { people: 'members', person: 'member' };
const STUDIO = { people: 'clients', person: 'client' };
const p = (name, n) => ({ name, entryId: `aaaaaaaa-aaaa-4aaa-8aaa-${String(n).padStart(12, '0')}`, userId: null });
const preview = (over = {}) => ({ selected: 1, move: [], endApp: [], kept: [], large: null, digest: 'a'.repeat(64), ...over });

describe('the box for each door', () => {
  const cases = [
    ['list', GYM, 'Remove members', 'You selected 4 members.'],
    ['past', GYM, 'Remove past members from the app', 'You selected 4 past members.'],
    ['app', GYM, 'Remove from the app', 'You selected 4 people in the app.'],
    ['list', STUDIO, 'Remove clients', 'You selected 4 clients.'],
  ];
  it.each(cases)('%s (%o)', (door, words, title, selected) => {
    expect(removeTitle(door, words)).toBe(title);
    expect(removeSelectedLine(preview({ selected: 4 }), door, words)).toBe(selected);
  });

  it('one person is said in the singular', () => {
    expect(removeSelectedLine(preview({ selected: 1 }), 'list', GYM)).toBe('You selected 1 member.');
    expect(removeSelectedLine(preview({ selected: 1 }), 'app', GYM)).toBe('You selected 1 person in the app.');
  });
});

describe('who changes, and the button', () => {
  it('moves and app endings each get a heading and a line naming the gym', () => {
    const groups = removeChangeGroups(preview({ move: [p('A', 1), p('B', 2)], endApp: [p('A', 1)] }), GYM, 'Iron House Gym');
    expect(groups.map((g) => [g.key, g.heading, g.line])).toEqual([
      ['move', '2 will move to past members', 'Their details are kept, and you can put them back at any time.'],
      ['endApp', '1 will lose access to the app', "They keep their own workouts and the free app. The app tells them they're no longer a member of Iron House Gym."],
    ]);
  });

  const buttons = [
    ['list, records moving', 'list', { move: [p('A', 1), p('B', 2)], endApp: [p('A', 1)] }, 'Remove 2 members'],
    ['list, one', 'list', { move: [p('A', 1)] }, 'Remove 1 member'],
    ['past, app only', 'past', { endApp: [p('A', 1), p('B', 2)] }, 'Remove 2 from the app'],
    ['in the app', 'app', { move: [p('A', 1)], endApp: [p('A', 1), p('B', 2), p('C', 3)] }, 'Remove 3 from the app'],
    ['nobody to remove', 'list', {}, null],
    ['past, nobody in the app', 'past', { kept: [{ reason: 'not_in_app', people: [p('A', 1)] }] }, null],
  ];
  it.each(buttons)('%s', (_name, door, over, label) => {
    expect(removeButton(preview(over), door, GYM)).toBe(label);
  });

  it('a big removal asks in words that say what and of how many', () => {
    expect(removeLargeWords(preview(), GYM)).toBeNull();
    expect(removeLargeWords(preview({ large: { kind: 'app', removing: 60, of: 146 } }), GYM)).toBe('Yes, remove 60 of your 146 members in the app.');
    expect(removeLargeWords(preview({ large: { kind: 'list', removing: 1300, of: 1200 } }), GYM)).toBe('Yes, move 1,300 of your 1,200 members to past members.');
  });
});

describe("who doesn't change", () => {
  it('a line per reason; someone no longer there is a count, not a blank name', () => {
    const kept = removeKept(
      preview({
        kept: [
          { reason: 'staff', people: [p('Coach Dee', 1)] },
          { reason: 'shared_email', people: [p('Kim', 2)] },
          { reason: 'gone', people: [p('', 3), p('', 4)] },
        ],
      }),
      GYM,
      'list',
    );
    expect(kept.heading).toBe("4 won't change");
    expect(kept.groups.map((g) => [g.key, g.line, g.people.length, g.count])).toEqual([
      ['staff', 'Owner and staff keep the app. Manage staff in Settings.', 1, 1],
      ['shared_email', "Keep the app: they share an email address with someone still on your list, so we can't tell whose it is.", 1, 1],
      ['gone', 'No longer on your list.', 0, 2],
    ]);
    expect(removeKept(preview({ kept: [{ reason: 'gone', people: [p('', 3)] }] }), GYM, 'app').groups[0].line).toBe('No longer in the app.');
    expect(removeKept(preview(), GYM, 'list').heading).toBeNull();
  });
});

describe('once done', () => {
  const cases = [
    ['list, both', 'list', { moved: 4, endedApp: 2, alreadyRemoved: false }, '4 members moved to past members. 2 people lost access to the app.'],
    ['list, records only', 'list', { moved: 1, endedApp: 0, alreadyRemoved: false }, '1 member moved to past members.'],
    ['list, one app', 'list', { moved: 2, endedApp: 1, alreadyRemoved: false }, '2 members moved to past members. 1 person lost access to the app.'],
    ['past', 'past', { moved: 0, endedApp: 2, alreadyRemoved: false }, '2 removed from the app.'],
    ['in the app, records too', 'app', { moved: 1, endedApp: 3, alreadyRemoved: false }, '3 removed from the app. 1 member moved to past members.'],
    ['the same press again', 'list', { moved: 4, endedApp: 2, alreadyRemoved: true }, 'These members were already removed.'],
  ];
  it.each(cases)('%s', (_name, door, removed, line) => {
    expect(removeDoneLine(removed, door, GYM)).toBe(line);
  });
});

describe('names shown', () => {
  it('the first few, and how many more', () => {
    const people = Array.from({ length: 8 }, (_, i) => p(`P${String(i)}`, i));
    expect(namesShown(people, 5)).toEqual({ list: people.slice(0, 5), more: 3 });
    expect(namesShown(people, 100)).toEqual({ list: people, more: 0 });
  });
});
