// MEMBERSHIPS ON THE MEMBER LIST, their words (spec Part 3 §13.2; ROADMAP 17a-iii). Pure,
// so the tests read every state without a browser.
//
// A gym's member list says which membership each person has ("Gold"). Such a name IS a
// membership, so it is shown in the gym's one list of memberships (the
// Memberships page): as a type's own line where it is that type, and under "not set up yet"
// where it is no type so far. The server decides who gets a membership and works out
// each date (`linkHeldMembership` in `@app/shared`); this file only puts them into words.
import { formatMinor } from '@app/shared';
import { dayWords } from './memberListView';

const people = (n) => `${n.toLocaleString('en')} ${n === 1 ? 'person' : 'people'}`;

/** A name from the member list, in quotes so it reads as the list's own. */
export const quoted = (word) => `“${word}”`;

/** The list's names that are no membership type yet, in the list's own order. One whose
 *  type was archived is among them: it cannot be given until it is set up again. */
export function notSetUp(words) {
  return words.filter((w) => (w.link === null ? w.sameName === null : w.link.typeArchived));
}

/** "“Gold” · 6 people". */
export function nameLine(w) {
  return `${quoted(w.word)} · ${people(w.people)}`;
}

/** Under a not-set-up name whose type was archived: what happened, or null. */
export function archivedLine(w) {
  if (w.link === null || !w.link.typeArchived) return null;
  return `You set this up as ${w.link.typeName}, which is now archived. Put ${w.link.typeName} back, or set ${quoted(w.word)} up again.`;
}

/** What one live type has to do with the member list, a line each, in plain facts:
 *    - a name staff said is this type ("On your member list this is “Gold” · 6 people"),
 *      which can be undone;
 *    - the list's own use of this type's very name, said only while somebody with it
 *      has never had the membership.
 *  `give` is whether anybody with the name can be given the type: somebody who has never
 *  had it, or somebody whose membership ended and whose list shows a later end date
 *  (`renew` is true where those are the only ones). `first` is true where
 *  nobody with it has: the people are offered it outright. Otherwise some were given it
 *  and some were not, perhaps on purpose, so the row states the numbers and offers a
 *  look at who can get it, never a prompt to give. */
export function typeTies(type, words, canGive = true) {
  const ties = [];
  const never = (waiting) => `${String(waiting)} of them ${waiting === 1 ? 'has' : 'have'} never had it`;
  // Somebody whose membership ended, and whose list shows a later end date. A gym that can
  // only read is not told it can renew.
  const renewals = (again) =>
    ` ${endedLine(again === 1 ? "1 person's" : `${String(again)} people's`, type.name, again !== 1, 'member')}${canGive ? (again === 1 ? ' You can renew it.' : ' You can renew them.') : ''}`;
  const ownName = (w, waiting, again) => ({
    word: w,
    text:
      (waiting === w.people
        ? `${people(w.people)} on your member list ${w.people === 1 ? 'has' : 'have'} ${type.name}, but it is not on their ${w.people === 1 ? 'page' : 'pages'} yet.`
        : waiting === 0
          ? `On your member list ${people(w.people)} ${w.people === 1 ? 'has' : 'have'} ${type.name}.`
          : `On your member list ${people(w.people)} ${w.people === 1 ? 'has' : 'have'} ${type.name}. ${never(waiting)} here.`) + (again > 0 ? renewals(again) : ''),
    give: true,
    renew: waiting === 0,
    first: waiting === w.people,
    undo: false,
    own: true,
  });
  for (const w of words) {
    if (w.link !== null) {
      if (w.link.typeArchived || w.link.typeId !== type.id) continue;
      const { waiting } = w.link;
      const again = w.link.again ?? 0;
      // The server says whether the name is the type's own: it folds both, the screen never does.
      if (w.link.ownName) {
        if (waiting > 0 || again > 0) ties.push(ownName(w, waiting, again));
        continue;
      }
      const is = `On your member list this is ${quoted(w.word)} · ${people(w.people)}.`;
      ties.push({
        word: w,
        text: (waiting === 0 ? is : waiting === w.people ? `${is} They have never had it.` : `${is} ${never(waiting)}.`) + (again > 0 ? renewals(again) : ''),
        give: waiting > 0 || again > 0,
        renew: waiting === 0 && again > 0,
        first: waiting === w.people,
        undo: true,
        own: false,
      });
    } else if (w.sameName !== null && w.sameName.typeId === type.id && (w.sameName.waiting > 0 || (w.sameName.again ?? 0) > 0)) {
      ties.push(ownName(w, w.sameName.waiting, w.sameName.again ?? 0));
    }
  }
  return ties;
}

/** The button on a type's row that opens the box for one of the list's names. */
export function tieButton(type, tie) {
  const who = tie.own ? 'on your member list' : `with ${tie.word.word} on your member list`;
  if (tie.first) return { label: 'Give it to them', aria: `Give ${type.name} to the people ${who}`, main: true };
  // Only renewals wait: the button says so.
  if (tie.renew === true) return { label: 'Renew memberships', aria: `Renew ${type.name} for the people ${who}`, main: false };
  return { label: 'See who can get it', aria: `See who ${who} can get ${type.name}`, main: false };
}

/** The closed section's line, with how many of the list's names wait to be set up. */
export function withSetUpCount(summary, words) {
  if (summary === undefined) return undefined;
  const n = notSetUp(words).length;
  return n === 0 ? summary : `${summary} · ${String(n)} on your member list to set up`;
}

/** "Set up" on a name, where the gym already has types: is it one of them, or new? */
export function chooserWords(w) {
  return {
    question: `What is ${quoted(w.word)} here?`,
    existing: 'One of the memberships above',
    pick: 'Choose one',
    fresh: "A new membership. I'll add its price now.",
  };
}

/** The Add form, opened for a name from the list. */
export function formWordsFor(w) {
  return {
    heading: `Add ${quoted(w.word)} as a membership type`,
    hint: `${people(w.people)} on your member list ${w.people === 1 ? 'has' : 'have'} ${quoted(w.word)}. Add its price and how it is paid. Next you choose who gets it.`,
  };
}

/** Undoing "this name is this type". */
export function undoWords(w) {
  const typeName = w.link?.typeName ?? '';
  return {
    button: `This isn't ${quoted(w.word)}`,
    question: `Stop counting ${quoted(w.word)} on your member list as ${typeName}? Nobody's membership changes: to take one away, cancel it on that person's page. ${quoted(w.word)} goes back under “not set up yet”.`,
    confirm: 'Stop counting it',
    done: `Done. Nobody's membership changed. ${quoted(w.word)} is back under “not set up yet”.`,
  };
}

/** "Set up again" on a name whose type was archived: it stops counting as that type. */
export function againWords(w) {
  const typeName = w.link?.typeName ?? '';
  return {
    question: `Set ${quoted(w.word)} up again? It will no longer count as ${typeName}, which is archived. Nobody's membership changes.`,
    confirm: 'Set it up again',
    done: `${quoted(w.word)} no longer counts as ${typeName}. Nobody's membership changed. Set it up below.`,
  };
}

/** The date beside one person's name in the box: "renews 14 November 2026". */
export function personNote(person) {
  switch (person.group) {
    case 'settled':
    case 'ask':
      if (person.group === 'ask' && !person.dated) return 'starts today';
      if (person.renewsOn !== null) return `renews ${dayWords(person.renewsOn)}`;
      if (person.endsOn === null) return '';
      // Somebody who had it before: their new end date, said as a renewal.
      return person.again === true ? `renewal, ends ${dayWords(person.endsOn)}` : `ends ${dayWords(person.endsOn)}`;
    case 'due':
      return person.since === null ? '' : `due since ${dayWords(person.since)}`;
    case 'ended':
      return person.endsOn === null ? '' : `ended ${dayWords(person.endsOn)}`;
    default:
      return '';
  }
}

/** How many people a group names before "See all", and how many more each press shows:
 *  the Remove box's own pattern (`MemberListRemove.jsx`). */
export const NAMES_SHOWN = 3;
export const NAMES_PAGE = 100;

/** A group's people as rows, one person each: the first `shown` of those the server
 *  named. `more` is how many of the group are not on screen; `waiting` is how many of
 *  those another press can show (the server names the first 200 of a group). */
export function groupNames(preview, group, shown) {
  const inGroup = preview.people.filter((p) => p.group === group);
  const rows = inGroup.slice(0, shown).map((p) => {
    const note = personNote(p);
    return { id: p.entryId, name: p.fullName === '' ? 'No name' : p.fullName, note: note === '' ? '' : `${note.charAt(0).toUpperCase()}${note.slice(1)}` };
  });
  return { rows, more: preview.counts[group] - rows.length, waiting: inGroup.length - rows.length };
}

const recurring = (preview) => preview.type.kind === 'recurring';
const free = (preview) => preview.type.priceMinor === 0;

/** Whether everybody the box can give the membership to held it before and is being
 *  renewed: the box then says Renew, from its heading to its button. */
export function isRenewal(preview) {
  const { counts } = preview;
  const can = counts.settled + counts.due + counts.ask;
  return can > 0 && (counts.again ?? 0) === can;
}

/** The groups that get the membership, each with a tick: who they are and what each
 *  will read afterwards. Only groups with somebody in them. */
export function giveGroups(preview) {
  const { counts } = preview;
  const renewal = isRenewal(preview);
  const groups = [];
  if (counts.settled > 0) {
    groups.push({
      key: 'settled',
      title: renewal
        ? `${people(counts.settled)} to renew · nothing to pay`
        : free(preview)
          ? `${people(counts.settled)} · nothing to pay`
          : `${people(counts.settled)} · paid up`,
      detail: free(preview)
        ? `${preview.type.name} is free, so there is nothing to pay.`
        : 'Their renewal date in your list is still to come. Each keeps that date, and shows as paid until then.',
    });
  }
  if (counts.due > 0) {
    groups.push({
      key: 'due',
      title: `${people(counts.due)} · payment due`,
      detail: 'Their renewal date in your list has passed. Each will show "Payment due" from the month they are in now, never for the months before.',
    });
  }
  if (counts.ask > 0) {
    groups.push({
      key: 'ask',
      title: renewal ? `${people(counts.ask)} to renew` : `${people(counts.ask)} · your list doesn't say if they have paid`,
      detail: recurring(preview)
        ? 'Your list has no renewal date for them, so their membership starts today.'
        : renewal
          ? // Said once, under the box's heading.
            null
          : 'Where your list has an end date for them they keep it; otherwise it starts today.',
    });
  }
  return groups;
}

/** The people who get nothing, one line a reason. */
export function leftOut(preview) {
  const { counts, type } = preview;
  const lines = [];
  if (counts.has > 0) {
    lines.push({
      key: 'has',
      // In a box of renewals the people being renewed had it before too: say what is different.
      text: isRenewal(preview)
        ? `${people(counts.has)} ${counts.has === 1 ? 'is' : 'are'} not renewed: they still have ${type.name}, staff cancelled it, or your member list shows no later end date for them.`
        : `${people(counts.has)} already ${counts.has === 1 ? 'has' : 'have'} ${type.name}, or had it before.`,
    });
  }
  if (counts.ended > 0) lines.push({ key: 'ended', text: `${people(counts.ended)}: your list says their membership has ended.` });
  if (counts.full > 0) lines.push({ key: 'full', text: `${people(counts.full)} already ${counts.full === 1 ? 'has' : 'have'} as many memberships running as one person can.` });
  if (counts.day > 0) lines.push({ key: 'day', text: `${people(counts.day)}: the date in your list can't be used. Add their membership on their own page.` });
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

/** The box's own labels over the people who get it and the people who do not. */
export function boxLabels(preview) {
  return isRenewal(preview) ? { gets: 'Who is renewed', not: "Who isn't" } : { gets: 'Who gets it', not: "Who doesn't" };
}

/** Under a renewal's heading: why these people, and what each gets. Null for any other box. */
export function renewLead(preview) {
  if (!isRenewal(preview)) return null;
  const { name } = preview.type;
  return preview.counts.again === 1
    ? `This person's ${name} membership has ended, and your member list shows a later end date for them. They get a new ${name} up to that date.`
    : `Their ${name} memberships have ended, and your member list shows a later end date for them. Each gets a new ${name} up to the date beside their name.`;
}

/** Somebody in a box of new people had the membership before and it ended: why they are
 *  offered it again, or null. A renewal's own box says it under its heading. */
export function renewNote(preview) {
  const again = preview.counts.again ?? 0;
  if (again === 0 || isRenewal(preview)) return null;
  const { name } = preview.type;
  return again === 1
    ? `1 of these people had ${name} before and it has ended. Your member list shows a later end date for them, so this renews it up to that date.`
    : `${String(again)} of these people had ${name} before and it has ended. Your member list shows a later end date for them, so this renews it up to that date.`;
}

/** A pack's classes are not on the list: said before it is given. */
export function packNote(preview) {
  if (preview.type.kind !== 'pack' || preview.type.packClasses === null) return null;
  const n = preview.type.packClasses;
  return n === 1
    ? null
    : `Each gets all ${String(n)} classes: your list doesn't say how many they have used.`;
}

/** The ticks the box opens with. Where nobody with the name has the type yet, everybody
 *  who can get it is ticked. Where some already have it, the rest may have been left out
 *  on purpose: nobody is ticked, and staff tick who they mean. */
export function startTicks(preview) {
  // A renewal is ticked too: the list's own later date is what says they renewed.
  const on = preview.counts.has === 0 || isRenewal(preview);
  return { settled: on, due: on, ask: on };
}

/** The box's heading, its button, and what it says when nobody is ticked. Where the
 *  list's name is the type's own, it is said once, not twice. With nobody ticked there
 *  is nothing to give; a name that is not yet counted as this type (`counted` false, and
 *  not its own name) can still be counted as it, to give later. */
export function boxWords(preview, ticks, counted = false) {
  const n = givenCount(preview, ticks);
  const { name } = preview.type;
  const same = preview.ownName;
  const anyone = preview.counts.settled + preview.counts.due + preview.counts.ask > 0;
  // Everybody who can get it had it before: the box is a renewal, and says so.
  const renewal = isRenewal(preview);
  const heading = renewal
    ? `Renew ${name} for ${people(preview.counts.again)}?`
    : same
      ? `Give ${name} to the people who have it on your member list?`
      : `Give ${name} to the people with ${quoted(preview.word)} on your member list?`;
  if (n > 0) return { heading, button: renewal ? `Renew ${name} for ${people(n)}` : `Give ${name} to ${people(n)}`, nobody: null };
  if (same || counted) {
    return { heading, button: null, nobody: anyone ? (renewal ? `Tick who to renew.` : `Tick who should get ${name}.`) : `Nobody on your member list can be given ${name} now.` };
  }
  return {
    heading,
    button: `Count ${quoted(preview.word)} as ${name}`,
    nobody: anyone
      ? `Tick who should get ${name}. Or count ${quoted(preview.word)} on your member list as ${name} now, and give it to them later from this page.`
      : `Nobody on your member list can be given ${name} now. You can still count ${quoted(preview.word)} on your member list as ${name}.`,
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
    // The box as it was shown: a list or a type that has moved since is refused.
    digest: preview.digest,
    paid: asksPaid(preview, ticks) ? paid : null,
  };
}

/** The list's names that count as a live membership type, each with that type and how
 *  many of its people wait: never having had it, or with a later date on the list. */
function tiedNames(words) {
  return words.flatMap((w) => {
    if (w.link !== null) return w.link.typeArchived ? [] : [{ w, typeId: w.link.typeId, typeName: w.link.typeName, own: w.link.ownName, waiting: w.link.waiting, again: w.link.again ?? 0 }];
    return w.sameName === null ? [] : [{ w, typeId: w.sameName.typeId, typeName: w.sameName.typeName, own: true, waiting: w.sameName.waiting, again: w.sameName.again ?? 0 }];
  });
}

/** "2 members' 3 Months memberships have ended, and your member list shows a later end
 *  date for them." `whose` is who they are ("2 members'", "These members'"). */
function endedLine(whose, typeName, many, listOf) {
  return `${whose} ${typeName} ${many ? 'memberships have' : 'membership has'} ended, and your ${listOf} list shows a later end date for them.`;
}

/** The sign atop Members while a renewal waits: somebody whose membership has ended and
 *  whose list shows a later end date reads "Ended" there, and this says why, with the
 *  button that renews them. One a membership. Where the same box also holds people who
 *  never had the membership, the sign says so and its button says what the box is. */
export function renewalsWaiting(words, peopleWords) {
  const who = (n) => (n === 1 ? `1 ${peopleWords.person}` : `${n.toLocaleString('en')} ${peopleWords.people}`);
  return tiedNames(words)
    .filter((t) => t.again > 0)
    .map((t) => {
      const one = t.again === 1;
      const ended = endedLine(one ? `This ${peopleWords.person}'s` : `These ${peopleWords.people}'`, t.typeName, !one, peopleWords.person);
      return {
        key: `renew-${t.typeId}-${t.w.word}`,
        typeId: t.typeId,
        word: t.w.word,
        title: one ? '1 membership can be renewed' : `${t.again.toLocaleString('en')} memberships can be renewed`,
        // For a gym that can only read: the fact, and nothing it cannot do.
        titleOff: one ? '1 membership has ended' : `${t.again.toLocaleString('en')} memberships have ended`,
        detail: t.waiting === 0 ? ended : `${ended} The same box also lists ${who(t.waiting)} who ${t.waiting === 1 ? 'has' : 'have'} never had ${t.typeName}.`,
        button: t.waiting > 0 ? 'See who can get it' : one ? 'Renew their membership' : 'Renew their memberships',
        ask: `The owner can renew ${one ? 'it' : 'them'} on the Memberships page.`,
      };
    });
}

/** After an import: what is left to do about the memberships the gym has set up, a
 *  sentence and a button each, the renewals first. `words` are the list's membership
 *  names as the server reads them now; `peopleWords` the gym's own word for its people.
 *  Each step opens the box for that name on the Memberships page, so a name with both
 *  renewals and people who never had it is ONE step. `ask` is who can, for somebody who
 *  may not open that page. */
export function afterImportSteps(words, peopleWords) {
  const who = (n) => (n === 1 ? `1 ${peopleWords.person}` : `${n.toLocaleString('en')} ${peopleWords.people}`);
  const never = (t) =>
    t.own
      ? `${who(t.waiting)} ${t.waiting === 1 ? 'has' : 'have'} ${t.typeName} on your ${peopleWords.person} list, but it is not on their ${t.waiting === 1 ? 'page' : 'pages'} yet.`
      : `${who(t.waiting)} ${t.waiting === 1 ? 'has' : 'have'} ${quoted(t.w.word)} on your ${peopleWords.person} list and ${t.waiting === 1 ? 'has' : 'have'} not been given ${t.typeName} yet.`;
  const tied = tiedNames(words);
  const steps = [];
  for (const t of tied) {
    if (t.again === 0) continue;
    const one = t.again === 1;
    const ended = endedLine(one ? `1 ${peopleWords.person}'s` : `${t.again.toLocaleString('en')} ${peopleWords.people}'`, t.typeName, !one, peopleWords.person);
    steps.push({
      key: `renew-${t.typeId}-${t.w.word}`,
      typeId: t.typeId,
      word: t.w.word,
      text: t.waiting === 0 ? ended : `${ended} ${never(t)}`,
      button: t.waiting > 0 ? 'See who can get it' : one ? 'Renew their membership' : 'Renew their memberships',
      ask: t.waiting > 0 ? 'The owner can do both on the Memberships page.' : `The owner can renew ${one ? 'it' : 'them'} on the Memberships page.`,
    });
  }
  for (const t of tied) {
    if (t.waiting === 0 || t.again > 0) continue;
    steps.push({
      key: `give-${t.typeId}-${t.w.word}`,
      typeId: t.typeId,
      word: t.w.word,
      text: never(t),
      button: `Give them ${t.typeName}`,
      ask: 'The owner can give it to them on the Memberships page.',
    });
  }
  return steps;
}

/** What the press did, said back in one line. */
export function doneWords(given, word, typeName) {
  if (given === 0) return `${quoted(word)} on your member list now counts as ${typeName}. Nobody was given it.`;
  return `${people(given)} now ${given === 1 ? 'has' : 'have'} ${typeName}. You can see it on each person's page.`;
}
