// SETTINGS → MEMBERSHIPS, its words and its form's rules (spec Part 3 §13.1; ROADMAP
// 17a-i). Pure, so the tests read every state without a browser. A price is typed as a
// plain number and becomes whole minor units through `priceToMinor`, nowhere else.
import {
  MEMBERSHIP_BOOKINGS_LIMIT_MAX,
  MEMBERSHIP_DESCRIPTION_MAX,
  MEMBERSHIP_NAME_MAX,
  MEMBERSHIP_PACK_CLASSES_MAX,
  MEMBERSHIP_PACK_DAYS_MAX,
  MEMBERSHIP_TERM_COUNT_MAX,
  MEMBERSHIP_TYPES_MAX,
  currencyDecimals,
  formatMinor,
  isDayPass,
  isVisibleText,
  minorToPriceText,
  priceToMinor,
} from '@app/shared';

/** Whether this person may change the price list. The tick, never the job title: an
 *  owner can give it to anyone on staff. */
export function canManageMemberships(privileges) {
  return Array.isArray(privileges) && privileges.includes('memberships.manage');
}

/** HOW A MEMBERSHIP IS PAID FOR: the five ways the form offers, in the words gym software
 *  uses (PushPress, TeamUp and Gymdesk all say "Recurring"; TeamUp "Pack"; Gymdesk "One
 *  time" and "Trial"). The membership itself, its name, price and what it includes, is
 *  the gym's own. A day pass is kept as a pack of 1 class for 1 day. */
export const KIND_CHOICES = [
  { value: 'recurring', label: 'Recurring', hint: 'Charged every week, month or year until the member cancels.' },
  { value: 'one_time', label: 'One-time payment', hint: 'Paid once. Lasts a set time, then ends.' },
  { value: 'pack', label: 'Class pack', hint: 'Paid once. A number of classes to use within a set time.' },
  { value: 'day_pass', label: 'Day pass', hint: 'Paid once. One visit, on the day.' },
  { value: 'trial', label: 'Trial', hint: 'A short first membership, free or paid.' },
];

export const ACCESS_CHOICES = [
  { value: 'all_classes', label: 'Unlimited classes' },
  { value: 'limited', label: 'A limit on classes' },
  { value: 'gym_only', label: 'No classes, gym only' },
];

export const LIMIT_PERIOD_CHOICES = [
  { value: 'week', label: 'a week' },
  { value: 'month', label: 'a month' },
];

/** Which of the five a saved type is. */
export function kindChoice(type) {
  return isDayPass(type) ? 'day_pass' : type.kind;
}

const KIND_TAGS = {
  recurring: 'Recurring',
  one_time: 'One time',
  pack: 'Class pack',
  day_pass: 'Day pass',
  trial: 'Trial',
};

/** The short word beside a type's name. */
export function kindTag(type) {
  return KIND_TAGS[kindChoice(type)] ?? '';
}

const plural = (n, one, many) => `${String(n)} ${n === 1 ? one : many}`;
const UNIT_WORDS = { day: ['day', 'days'], week: ['week', 'weeks'], month: ['month', 'months'], year: ['year', 'years'] };
const unitWords = (unit) => UNIT_WORDS[unit] ?? [unit, unit];

/** "Free", or the price in the type's own money. */
export function priceLabel(type) {
  return type.priceMinor === 0 ? 'Free' : formatMinor(type.priceMinor, type.currency);
}

/** What it costs and how long it lasts: "$49.99 every month", "£15.00 · 1 visit, on the day". */
export function termLine(type) {
  const price = priceLabel(type);
  const choice = kindChoice(type);
  if (choice === 'day_pass') return `${price} · 1 visit, on the day`;
  if (choice === 'pack') {
    return `${price} · ${plural(type.packClasses, 'class', 'classes')}, used within ${plural(type.packDays, 'day', 'days')}`;
  }
  const [one, many] = unitWords(type.termUnit);
  if (choice === 'recurring') {
    const every = type.termCount === 1 ? `every ${one}` : `every ${String(type.termCount)} ${many}`;
    return type.priceMinor === 0 ? `Free · renews ${every}` : `${price} ${every}`;
  }
  const lasts = `lasts ${plural(type.termCount, one, many)}`;
  return choice === 'one_time' ? `${price} once · ${lasts}` : `${price} · ${lasts}`;
}

/** What it includes: "Unlimited classes", "8 classes a month · only Yoga", "No classes, gym only". */
export function includesLine(type) {
  if (type.access === 'gym_only') return 'No classes, gym only';
  const limited = type.access === 'limited';
  const amount = limited
    ? `${plural(type.bookingsLimit, 'class', 'classes')} a ${type.bookingsPeriod}`
    : isDayPass(type)
      ? 'The gym or any class'
      : type.kind === 'pack'
        ? 'Any class'
        : 'Unlimited classes';
  if (!Array.isArray(type.classTypes)) return amount;
  const names = type.classTypes.map((c) => c.name);
  const shown = names.length <= 3 ? names.join(', ') : `${names.slice(0, 3).join(', ')} and ${String(names.length - 3)} more`;
  const which = names.length === 0 ? 'no classes ticked' : `only ${shown}`;
  return limited ? `${amount} · ${which}` : `${which.charAt(0).toUpperCase()}${which.slice(1)}`;
}

/** The closed box's line. */
export function typesSummary(list) {
  if (list === null || !Array.isArray(list.types)) return undefined;
  if (list.types.length === 0) return 'Nothing for sale yet';
  return list.types.length === 1 ? '1 membership type' : `${String(list.types.length)} membership types`;
}

/** Whether there is room for another live type. */
export function canAddType(list) {
  return Array.isArray(list?.types) && list.types.length < MEMBERSHIP_TYPES_MAX;
}

export const TOO_MANY_TYPES = `You can have ${String(MEMBERSHIP_TYPES_MAX)} membership types. Archive one you no longer sell first.`;

/** "Showing the newest 200 of 240", or null when the archived list is whole. */
export function archivedNote(list) {
  if (!Array.isArray(list?.archived) || list.archivedTotal <= list.archived.length) return null;
  return `Showing the newest ${String(list.archived.length)} of ${String(list.archivedTotal)}.`;
}

/** A new type's form, before anything is typed. */
export function emptyDraft() {
  return {
    id: null,
    updatedAt: null,
    name: '',
    description: '',
    choice: 'recurring',
    price: '',
    termCount: '1',
    termUnit: 'month',
    packClasses: '10',
    packDays: '60',
    access: 'all_classes',
    bookingsLimit: '8',
    bookingsPeriod: 'month',
    classScope: 'all',
    classIds: [],
  };
}

/** A saved type, as the form holds it. */
export function draftFromType(type) {
  const base = emptyDraft();
  const choice = kindChoice(type);
  return {
    ...base,
    id: type.id,
    updatedAt: type.updatedAt,
    name: type.name,
    description: type.description ?? '',
    choice,
    price: minorToPriceText(type.priceMinor, type.currency),
    termCount: type.termCount === null ? base.termCount : String(type.termCount),
    termUnit: type.termUnit ?? base.termUnit,
    packClasses: type.packClasses === null ? base.packClasses : String(type.packClasses),
    packDays: type.packDays === null ? base.packDays : String(type.packDays),
    access: type.access,
    bookingsLimit: type.bookingsLimit === null ? base.bookingsLimit : String(type.bookingsLimit),
    bookingsPeriod: type.bookingsPeriod ?? base.bookingsPeriod,
    classScope: type.classTypes === null ? 'all' : 'some',
    classIds: type.classTypes === null ? [] : type.classTypes.map((c) => c.id),
  };
}

/** The classes the form can tick: the gym's live ones, and any this type already covers
 *  (a class the gym has since stopped running stays ticked until somebody unticks it). */
export function classOptions(list, type) {
  const live = Array.isArray(list?.classChoices) ? list.classChoices : [];
  const kept = Array.isArray(type?.classTypes) ? type.classTypes.filter((c) => !live.some((l) => l.id === c.id)) : [];
  return [...live, ...kept];
}

/** The units a length can be counted in: a repeating type is never charged by the day. */
export function termUnitOptions(choice) {
  const units = choice === 'recurring' ? ['week', 'month', 'year'] : ['day', 'week', 'month', 'year'];
  return units.map((unit) => ({ value: unit, label: unitWords(unit)[1] }));
}

/** A whole number in a range, or null. Digits only: "1.5", "1e2" and "" are not numbers here. */
export function wholeNumber(text, min, max) {
  if (typeof text !== 'string' || !/^\d{1,4}$/.test(text.trim())) return null;
  const n = Number(text.trim());
  return n >= min && n <= max ? n : null;
}

/** "49.99" for dollars, "5000" for a currency with no decimals. */
export function priceExample(currency) {
  return currencyDecimals(currency) === 0 ? '5000' : '49.99';
}

const usesTerm = (choice) => choice === 'recurring' || choice === 'one_time' || choice === 'trial';
const usesAccess = usesTerm;

/** The boxes in the order the form draws them, so the first wrong one can be shown. */
export const PROBLEM_ORDER = ['name', 'description', 'price', 'termCount', 'packClasses', 'packDays', 'bookingsLimit', 'classes'];

/** The first box that is wrong, top to bottom, or null. */
export function firstProblem(problems) {
  if (problems === null || problems === undefined) return null;
  return PROBLEM_ORDER.find((key) => problems[key] !== undefined) ?? null;
}

/** The line beside the Save button when the form was not saved. */
export const NOT_SAVED = 'Not saved yet. Fix what is marked in red above.';

/** A pack of 1 class for 1 day IS a day pass (§13.1) and would open as one, its two boxes
 *  gone: the pack form sends the gym to the right choice. */
export const PACK_IS_DAY_PASS = '1 class used within 1 day is a day pass. Add it as a Day pass, or change a number.';

/** A name or description holding a character nobody can see, usually pasted in. */
export const HIDDEN_TEXT = 'Something hidden was pasted in with this. Delete it and type it again.';

/** What is wrong with the form, one sentence a field, or null when it can be saved. */
export function draftProblems(draft, currency) {
  const problems = {};
  const name = draft.name.trim();
  if (name === '') problems.name = 'Give it a name, like Gold Monthly.';
  else if (name.length > MEMBERSHIP_NAME_MAX) problems.name = `Keep the name to ${String(MEMBERSHIP_NAME_MAX)} letters.`;
  else if (!isVisibleText(name)) problems.name = HIDDEN_TEXT;
  if (draft.description.trim().length > MEMBERSHIP_DESCRIPTION_MAX) {
    problems.description = `Keep the description to ${String(MEMBERSHIP_DESCRIPTION_MAX)} letters.`;
  } else if (!isVisibleText(draft.description.trim())) {
    problems.description = HIDDEN_TEXT;
  }
  if (priceToMinor(draft.price, currency) === null) {
    problems.price = `Type the price as a number, like ${priceExample(currency)}. Type 0 for free.`;
  }
  if (usesTerm(draft.choice) && wholeNumber(draft.termCount, 1, MEMBERSHIP_TERM_COUNT_MAX) === null) {
    problems.termCount = `Type a whole number from 1 to ${String(MEMBERSHIP_TERM_COUNT_MAX)}.`;
  }
  if (draft.choice === 'pack') {
    if (wholeNumber(draft.packClasses, 1, MEMBERSHIP_PACK_CLASSES_MAX) === null) {
      problems.packClasses = `Type how many classes, from 1 to ${String(MEMBERSHIP_PACK_CLASSES_MAX)}.`;
    }
    if (wholeNumber(draft.packDays, 1, MEMBERSHIP_PACK_DAYS_MAX) === null) {
      problems.packDays = `Type how many days, from 1 to ${String(MEMBERSHIP_PACK_DAYS_MAX)}.`;
    }
    if (problems.packClasses === undefined && problems.packDays === undefined && wholeNumber(draft.packClasses, 1, 1) === 1 && wholeNumber(draft.packDays, 1, 1) === 1) {
      problems.packDays = PACK_IS_DAY_PASS;
    }
  }
  if (
    usesAccess(draft.choice) &&
    draft.access === 'limited' &&
    wholeNumber(draft.bookingsLimit, 1, MEMBERSHIP_BOOKINGS_LIMIT_MAX) === null
  ) {
    problems.bookingsLimit = `Type how many classes, from 1 to ${String(MEMBERSHIP_BOOKINGS_LIMIT_MAX)}.`;
  }
  if (coversSomeClasses(draft) && draft.classIds.length === 0) {
    problems.classes = 'Tick at least one class, or choose Every class.';
  }
  return Object.keys(problems).length === 0 ? null : problems;
}

/** Whether the form's ticked classes apply: not for a gym-only type. */
function coversSomeClasses(draft) {
  const gymOnly = usesAccess(draft.choice) && draft.access === 'gym_only';
  return !gymOnly && draft.classScope === 'some';
}

/** The request the form sends: every field every time. Call only when `draftProblems`
 *  is null. */
export function draftBody(draft, currency) {
  const pack = draft.choice === 'pack' || draft.choice === 'day_pass';
  const access = pack ? 'all_classes' : draft.access;
  return {
    name: draft.name.trim(),
    description: draft.description.trim() === '' ? null : draft.description.trim(),
    kind: draft.choice === 'day_pass' ? 'pack' : draft.choice,
    priceMinor: priceToMinor(draft.price, currency),
    termCount: pack ? null : wholeNumber(draft.termCount, 1, MEMBERSHIP_TERM_COUNT_MAX),
    termUnit: pack ? null : draft.termUnit,
    packClasses: draft.choice === 'day_pass' ? 1 : pack ? wholeNumber(draft.packClasses, 1, MEMBERSHIP_PACK_CLASSES_MAX) : null,
    packDays: draft.choice === 'day_pass' ? 1 : pack ? wholeNumber(draft.packDays, 1, MEMBERSHIP_PACK_DAYS_MAX) : null,
    access,
    bookingsLimit: access === 'limited' ? wholeNumber(draft.bookingsLimit, 1, MEMBERSHIP_BOOKINGS_LIMIT_MAX) : null,
    bookingsPeriod: access === 'limited' ? draft.bookingsPeriod : null,
    classTypeIds: coversSomeClasses(draft) ? [...draft.classIds] : null,
    // A change says which version of the type the form read.
    ...(draft.id === null ? {} : { updatedAt: draft.updatedAt }),
  };
}

/** The form after its kind changes: a repeating type cannot be charged by the day. */
export function withChoice(draft, choice) {
  const termUnit = choice === 'recurring' && draft.termUnit === 'day' ? 'month' : draft.termUnit;
  return { ...draft, choice, termUnit };
}
