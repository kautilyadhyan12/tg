// MEMBERSHIPS FROM YOUR LIST, their words (spec Part 3 §13.2; ROADMAP 17a-iii). Pure, so
// the tests read every state without a browser. The server decides who gets a
// membership and works out each date (`linkHeldMembership` in `@app/shared`); this file
// only puts them into words.
import { formatMinor } from '@app/shared';
import { dayWords } from './memberListView';

const people = (n) => `${n.toLocaleString('en')} ${n === 1 ? 'person' : 'people'}`;

/** A name from the list's Membership column, in quotes so it reads as the list's own. */
export const quoted = (word) => `“${word}”`;

/** "“Gold” · 42 people on your list". */
export function wordLine(w) {
  return `${quoted(w.word)} · ${people(w.people)} on your list`;
}

/** A name that is already one of the gym's own types, with nobody left to give it to,
 *  is not a question: it is not drawn. */
export function isSettled(w) {
  return w.link === null && w.sameName !== null && w.sameName.waiting === 0;
}

/** What a row shows and offers:
 *    choose  the list's name is not yet any type: staff pick one;
 *    same    it is the name of one of the gym's types, and some people do not have it;
 *    set     staff picked its type before. `canGive` where people still do not have it. */
export function rowWords(w) {
  if (w.link !== null) {
    const { typeName, typeArchived, waiting } = w.link;
    if (typeArchived) {
      return { kind: 'set', canGive: false, text: `${quoted(w.word)} is ${typeName}, which is archived. Put it back above to give it to more people.` };
    }
    if (waiting === 0) {
      return { kind: 'set', canGive: false, text: `${quoted(w.word)} is ${typeName}. Everyone with it on your list has ${typeName}, or had it before.` };
    }
    return {
      kind: 'set',
      canGive: true,
      text: `${quoted(w.word)} is ${typeName}. ${people(waiting)} ${waiting === 1 ? "doesn't" : "don't"} have ${typeName} yet.`,
    };
  }
  if (w.sameName !== null) {
    const { typeName, waiting } = w.sameName;
    return {
      kind: 'same',
      canGive: true,
      text: `This is your membership type ${typeName}. ${people(waiting)} ${waiting === 1 ? "doesn't" : "don't"} have it yet.`,
    };
  }
  return { kind: 'choose', canGive: false, text: null };
}

/** The date beside one person's name in the box: "renews 14 November 2026". */
export function personNote(person) {
  switch (person.group) {
    case 'settled':
    case 'ask':
      if (person.group === 'ask' && !person.dated) return 'starts today';
      if (person.renewsOn !== null) return `renews ${dayWords(person.renewsOn)}`;
      return person.endsOn === null ? '' : `ends ${dayWords(person.endsOn)}`;
    case 'due':
      return person.since === null ? '' : `due since ${dayWords(person.since)}`;
    case 'ended':
      return person.endsOn === null ? '' : `ended ${dayWords(person.endsOn)}`;
    default:
      return '';
  }
}

/** How many names a group shows before "See all". */
export const NAMES_SHOWN = 3;

/** A group's names: the first few, or all the server sent, and how many are not named. */
export function groupNames(preview, group, all) {
  const inGroup = preview.people.filter((p) => p.group === group);
  const named = all ? inGroup : inGroup.slice(0, NAMES_SHOWN);
  return {
    names: named.map((p) => {
      const note = personNote(p);
      return { id: p.entryId, text: note === '' ? p.fullName : `${p.fullName} (${note})` };
    }),
    more: preview.counts[group] - named.length,
    // Names the server left out of a very long group.
    unnamed: preview.counts[group] - inGroup.length,
    canSeeAll: inGroup.length > NAMES_SHOWN,
  };
}

const recurring = (preview) => preview.type.kind === 'recurring';
const free = (preview) => preview.type.priceMinor === 0;

/** The groups that get the membership, each with a tick: who they are and what each
 *  will read afterwards. Only groups with somebody in them. */
export function giveGroups(preview) {
  const { counts } = preview;
  const groups = [];
  if (counts.settled > 0) {
    groups.push({
      key: 'settled',
      title: free(preview) ? `${people(counts.settled)} · nothing to pay` : `${people(counts.settled)} · paid up`,
      detail: free(preview)
        ? `${preview.type.name} is free. Where your list has a date for them they keep it; otherwise it starts today.`
        : 'Their renewal date in your list is still to come. Each keeps that date, and shows as paid until then.',
    });
  }
  if (counts.due > 0) {
    groups.push({
      key: 'due',
      title: `${people(counts.due)} · payment due`,
      detail: 'Their renewal date in your list has passed. Each will show "Payment due" since that date.',
    });
  }
  if (counts.ask > 0) {
    groups.push({
      key: 'ask',
      title: `${people(counts.ask)} · your list doesn't say if they have paid`,
      detail: recurring(preview)
        ? 'Your list has no renewal date for them, so their membership starts today.'
        : 'Where your list has an end date for them they keep it; otherwise it starts today.',
    });
  }
  return groups;
}

/** The people who get nothing, one line a reason. */
export function leftOut(preview) {
  const { counts, type } = preview;
  const lines = [];
  if (counts.has > 0) lines.push({ key: 'has', text: `${people(counts.has)} already ${counts.has === 1 ? 'has' : 'have'} ${type.name}, or had it before.` });
  if (counts.ended > 0) lines.push({ key: 'ended', text: `${people(counts.ended)}: your list says their membership has ended.` });
  if (counts.full > 0) lines.push({ key: 'full', text: `${people(counts.full)} already ${counts.full === 1 ? 'has' : 'have'} as many memberships running as one person can.` });
  if (counts.day > 0) lines.push({ key: 'day', text: `${people(counts.day)}: the date in your list is too far away to use. Add their membership on their own page.` });
  if (counts.past > 0) {
    lines.push({
      key: 'past',
      text: `${counts.past === 1 ? '1 past member has' : `${counts.past.toLocaleString('en')} past members have`} ${quoted(preview.word)} too. They are not on your list now, so they get nothing.`,
    });
  }
  return lines;
}

/** How many people the ticked groups hold. */
export function givenCount(preview, ticks) {
  return ['settled', 'due', 'ask'].reduce((sum, key) => sum + (ticks[key] ? preview.counts[key] : 0), 0);
}

/** Whether the paid question is asked: somebody ticked whom the list does not settle. */
export function asksPaid(preview, ticks) {
  return ticks.ask && preview.counts.ask > 0;
}

/** The paid question's words. */
export function paidQuestion(preview) {
  const price = formatMinor(preview.type.priceMinor, preview.type.currency);
  return {
    question: preview.counts.ask === 1 ? `Has this person paid the ${price}?` : `Have these ${people(preview.counts.ask)} paid the ${price}?`,
    yes: 'Yes, they have paid',
    no: 'No, not yet',
  };
}

/** A pack's classes are not on the list: said before it is given. */
export function packNote(preview) {
  if (preview.type.kind !== 'pack' || preview.type.packClasses === null) return null;
  const n = preview.type.packClasses;
  return n === 1
    ? null
    : `Each gets all ${String(n)} classes: your list doesn't say how many they have used.`;
}

/** The box's heading and its button. */
export function boxWords(preview, ticks) {
  const n = givenCount(preview, ticks);
  return {
    heading: `Give ${preview.type.name} to the people with ${quoted(preview.word)} on your list?`,
    button: n === 0 ? `Remember that ${quoted(preview.word)} is ${preview.type.name}` : `Give ${preview.type.name} to ${people(n)}`,
    nobody:
      n === 0
        ? `Nobody is given ${preview.type.name} now. It is remembered, so you can give it later.`
        : null,
  };
}

/** Why the button cannot be pressed yet, or null. */
export function boxProblem(preview, ticks, paid) {
  return asksPaid(preview, ticks) && paid === null ? 'Say whether they have paid.' : null;
}

/** What the server is sent. */
export function linkBody(preview, ticks, paid) {
  return {
    word: preview.word,
    typeId: preview.type.id,
    groups: { settled: ticks.settled, due: ticks.due, ask: ticks.ask },
    expected: { settled: preview.counts.settled, due: preview.counts.due, ask: preview.counts.ask },
    paid: asksPaid(preview, ticks) ? paid : null,
  };
}

/** What the press did, said back in one line. */
export function doneWords(given, word, typeName) {
  if (given === 0) return `${quoted(word)} is now ${typeName}. Nobody was given it.`;
  return `${people(given)} now ${given === 1 ? 'has' : 'have'} ${typeName}. You can see it on each person's page.`;
}

export const UNLINK_QUESTION = (w) =>
  `Forget that ${quoted(w.word)} is ${w.link.typeName}? Nobody's membership changes. You can then choose again.`;

export const UNLINK_DONE = (w) => `Done. Nobody's membership changed. You can choose a membership type for ${quoted(w.word)} again.`;
