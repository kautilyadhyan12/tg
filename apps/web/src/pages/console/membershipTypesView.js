// SETTINGS → MEMBERSHIPS, its words and its form's rules (spec Part 3 §13.1; ROADMAP
// 17a-i). Pure, so the tests read every state without a browser. A price is typed as a
// plain number and becomes whole minor units through `priceToMinor`, nowhere else.
import {
  MEMBERSHIP_BOOKINGS_LIMIT_MAX,
  MEMBERSHIP_DESCRIPTION_MAX,
  MEMBERSHIP_NAME_MAX,
  MEMBERSHIP_PACK_CLASSES_MAX,
  MEMBERSHIP_PACK_DAYS_MAX,
  MEMBERSHIP_PT_LIMIT_MAX,
  MEMBERSHIP_CONTRACT_PERIODS_MAX,
  MEMBERSHIP_NOTICE_DAYS_MAX,
  MEMBERSHIP_COOLING_OFF_DAYS_MAX,
  MEMBERSHIP_TERM_COUNT_MAX,
  contractLengthWords,
  MEMBERSHIP_TYPES_MAX,
  currencyDecimals,
  formatMinor,
  isDayPass,
  isVisibleText,
  minorToPriceText,
  priceToMinor,
  MEMBERSHIP_PRICE_MINOR_MAX,
  TAXED_PRICE_MINOR_MAX,
  pcmToTaxRateText,
  SALES_TAX_PCM_MAX,
  canSellInApp,
} from '@app/shared';
import { reminderDayOptions } from './renewalReminderView';
import { RAISE_DRAFT, raiseBody, raiseProblem } from './priceRaiseView';

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
  { value: 'recurring', label: 'Recurring', hint: 'Charged every week, month or year until it is cancelled.' },
  { value: 'one_time', label: 'One-time payment', hint: 'Paid once. Lasts a set time, then ends.' },
  { value: 'pack', label: 'Class pack', hint: 'Paid once. A number of classes to use within a set time.' },
  { value: 'day_pass', label: 'Day pass', hint: 'Paid once. One visit, on the day.' },
  { value: 'trial', label: 'Trial', hint: 'A short first membership, free or paid.' },
];

const STUDIOS = ['studio', 'yoga_studio', 'pilates_studio'];
const OPEN_GYMS = ['crossfit_box', 'personal_trainer', 'clinic'];

/** What a place without classes is called, in each kind's own words: a gym's floor is "gym",
 *  a CrossFit's and a studio's is "open gym" and "open studio", as they call it themselves; an
 *  old personal trainer's or clinic's is "open gym", and a kind not known here is a gym's, as
 *  `orgWords` reads it. Read from the kind, not its name. The tick on Classes uses the same word. */
function openPlace(orgType) {
  if (STUDIOS.includes(orgType)) return { only: 'No classes, open studio only', or: 'Open studio or any class', open: 'open studio' };
  if (OPEN_GYMS.includes(orgType)) return { only: 'No classes, open gym only', or: 'Open gym or any class', open: 'open gym' };
  return { only: 'No classes, gym only', or: 'The gym or any class', open: 'open gym' };
}

/** The same place as a class's tick and tag on Classes: "Open gym", "Open studio". */
export function openSessionName(orgType) {
  const { open } = openPlace(orgType);
  return open.charAt(0).toUpperCase() + open.slice(1);
}

/** The example under a membership's description: "All classes and open studio". */
export function descriptionExample(orgType) {
  return `For example: All classes and ${openPlace(orgType).open}`;
}

export function accessChoices(orgType) {
  return [
    { value: 'all_classes', label: 'Unlimited classes' },
    { value: 'limited', label: 'A limit on classes' },
    { value: 'gym_only', label: openPlace(orgType).only },
  ];
}

export const LIMIT_PERIOD_CHOICES = [
  { value: 'week', label: 'a week' },
  { value: 'month', label: 'a month' },
];

/** How many personal training sessions a membership includes. */
export const PT_LIMIT_CHOICES = [
  { value: 'none', label: 'No limit' },
  { value: 'limited', label: 'A limit on sessions' },
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
    const holds = ptOnly(type) ? plural(type.packClasses, 'session', 'sessions') : plural(type.packClasses, 'class', 'classes');
    return `${price} · ${holds}, used within ${plural(type.packDays, 'day', 'days')}`;
  }
  const [one, many] = unitWords(type.termUnit);
  if (choice === 'recurring') {
    const every = type.termCount === 1 ? `every ${one}` : `every ${String(type.termCount)} ${many}`;
    return type.priceMinor === 0 ? `Free · renews ${every}` : `${price} ${every}`;
  }
  const lasts = `lasts ${plural(type.termCount, one, many)}`;
  return choice === 'one_time' ? `${price} once · ${lasts}` : `${price} · ${lasts}`;
}

/** A membership for personal training alone: no class ticked, and the tick for it. */
function ptOnly(type) {
  return type.includesPt === true && Array.isArray(type.classTypes) && type.classTypes.length === 0;
}

const PT_WORDS = 'Personal training';

/** Whether the type holds personal training to so many sessions a week or a month. */
function hasPtLimit(type) {
  return type.includesPt === true && Number.isInteger(type.ptLimit) && (type.ptPeriod === 'week' || type.ptPeriod === 'month');
}

/** What it includes: "Unlimited classes", "8 classes a month · only Yoga", "No classes, gym
 *  only", each with "· Personal training" where the type includes it, or with its limit:
 *  "· 4 personal training sessions a month". */
export function includesLine(type, orgType) {
  const limit = hasPtLimit(type) ? `${plural(type.ptLimit, 'session', 'sessions')} a ${type.ptPeriod}` : null;
  if (ptOnly(type)) return limit === null ? `${PT_WORDS} only` : `${PT_WORDS} only · ${limit}`;
  const classes = classesLine(type, orgType);
  if (type.includesPt !== true) return classes;
  return limit === null ? `${classes} · ${PT_WORDS}` : `${classes} · ${plural(type.ptLimit, 'personal training session', 'personal training sessions')} a ${type.ptPeriod}`;
}

function classesLine(type, orgType) {
  if (type.access === 'gym_only') return openPlace(orgType).only;
  const limited = type.access === 'limited';
  const amount = limited
    ? `${plural(type.bookingsLimit, 'class', 'classes')} a ${type.bookingsPeriod}`
    : isDayPass(type)
      ? openPlace(orgType).or
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

/** "GST 5% and QST 9.975%": rates in one phrase, in the order given. */
export function taxRatesPhrase(rates) {
  const labels = rates.map((r) => `${r.name} ${pcmToTaxRateText(r.pcm)}%`);
  return labels.length <= 1 ? (labels[0] ?? '') : `${labels.slice(0, -1).join(', ')} and ${labels[labels.length - 1]}`;
}

/** The gym's rates a type charges, in its order (18b-v-b); a rate since removed is left out. */
export function typeRates(type, list) {
  const rates = list?.taxRates ?? [];
  return (type.taxRateIds ?? []).map((id) => rates.find((r) => r.id === id)).filter((r) => r !== undefined);
}

/** The taxes a type's bills charge, in one line; null for none. "Plus GST 5% and QST 9.975%
 *  on each payment", or "Includes GST 18%" where the gym's prices hold the tax. */
export function typeTaxLine(type, list) {
  if (list === null) return null;
  const rates = typeRates(type, list);
  if (rates.length === 0) return null;
  const label = taxRatesPhrase(rates);
  return list.taxIncluded ? `Includes ${label}` : `Plus ${label} on each payment`;
}

/** "14.975%": what rates come to together. */
export const togetherText = (rates) => `${pcmToTaxRateText(rates.reduce((n, r) => n + r.pcm, 0))}%`;

/** Said once an archived type is put back. Where its taxes came to more than 30% together (a rate
 *  was raised while it was archived), the server took its last ones off: say which (18b-v-b). */
export function restoredTypeWords(type, list) {
  const now = (list?.types ?? []).find((t) => t.id === type.id);
  const taken = typeRates(type, list).filter((r) => now !== undefined && !(now.taxRateIds ?? []).includes(r.id));
  if (taken.length === 0) return null;
  const were = taken.length === 1 ? 'was' : 'were';
  return `${type.name} is back on your price list. ${taxRatesPhrase(taken)} ${were} taken off it, as its taxes came to more than 30% together. Press Change on ${type.name} to check its tax.`;
}

/** Whether a kind can have a joining fee (18t): one that opens a first bill to carry it. */
export const usesJoiningFee = (choice) => choice === 'recurring' || choice === 'one_time';

/** "Joining fee $25.00, on the first bill"; null for none. */
export function joiningFeeLine(type) {
  if (!(type.joiningFeeMinor > 0)) return null;
  return `Joining fee ${formatMinor(type.joiningFeeMinor, type.currency)}, on the first bill`;
}

/** "Contract: 12 months, then renews until cancelled" (18v-i); null for a type with none. */
export function contractLine(type) {
  if (type === null || type === undefined) return null;
  if (type.contractPeriods === null || type.contractPeriods === undefined || type.termCount === null || type.termUnit === null) return null;
  const length = contractLengthWords(type.contractPeriods, type.termCount, type.termUnit);
  return `Minimum term: ${length}, then ${type.contractThen === 'ends' ? 'it ends' : 'renews until cancelled'}`;
}

/** "Early cancellation fee: $99.00" (18v-ii-b); null for a type with none. */
export function leaveFeeLine(type) {
  if (type === null || type === undefined || !(type.leaveFeeMinor > 0) || type.contractPeriods === null || type.contractPeriods === undefined) return null;
  return `Early cancellation fee: ${formatMinor(type.leaveFeeMinor, type.currency)}`;
}

/** "Notice to cancel: 30 days" (18v-ii-a); null for a type with none. */
export function noticeLine(type) {
  if (type === null || type === undefined || type.noticeDays === null || type.noticeDays === undefined) return null;
  return `Notice to cancel: ${String(type.noticeDays)} day${type.noticeDays === 1 ? '' : 's'}`;
}

/** "Cooling-off period: 3 days" (18v-iii); null for a type with none. */
export function coolingOffLine(type) {
  if (type === null || type === undefined || !(type.coolingOffDays > 0) || !(type.priceMinor > 0)) return null;
  return `Cooling-off period: ${String(type.coolingOffDays)} day${type.coolingOffDays === 1 ? '' : 's'}`;
}

/** The ways of paying a member can buy in the app (18k-i): a paid-once membership or a pack (a day pass is one). A
 *  repeating membership waits for 18k-iv, once members can cancel it in the app (18l); never a trial. */
export const usesSellInApp = (choice) => choice === 'one_time' || choice === 'pack' || choice === 'day_pass';

/** WHETHER SQUARE CAN TAKE A MEMBER'S PAYMENT NOW (18k-i), from the Payments box: `ready`; `connect` or `location` for
 *  what the owner still has to do; `country` where Square is not offered; `off` where it can't be connected here yet;
 *  null while it is not known. */
export function squareSellState(payments) {
  if (payments === null || payments === undefined) return null;
  if (payments.availability !== 'square') return 'country';
  if (payments.squareReady !== true) return 'off';
  const square = payments.square;
  if (square === null || square === undefined || square.state === 'removed') return 'connect';
  return square.state === 'choose_location' ? 'location' : 'ready';
}

/** What the form says under Sell in the app, and the button to the place to fix it, by the state of Square. */
export function sellInAppHint(state, canConnect) {
  if (state === 'connect') return canConnect ? { text: 'Connect Square to sell in the app.', button: 'Connect Square' } : { text: 'Only the owner can connect Square.', button: null };
  if (state === 'location') return canConnect ? { text: 'Choose your Square location to sell in the app.', button: 'Choose location' } : { text: 'Only the owner can choose the Square location.', button: null };
  if (state === 'country') return { text: "Selling in the app isn't available in your country yet.", button: null };
  if (state === 'off') return { text: "Selling in the app isn't available yet.", button: null };
  if (state === 'ready') return { text: 'Members can buy it in the app and pay by card through Square.', button: null };
  // Square's state not known yet (still loading, or its read failed): what the tick does, and no more.
  return { text: 'Lets members buy it in the app.', button: null };
}

/** The row's word for a line sold in the app: the tag while members can buy it, a sentence while Square still has to
 *  be set up or the business has no plan with us (`no_plan`; `it` is "gym", "studio"), and null for a line not ticked
 *  or one that cannot be sold in the app. Not known yet, it says only that it is on. */
export function soldInAppWords(type, state, it = 'gym') {
  if (type?.soldInApp !== true || !canSellInApp(type)) return null;
  if (state === 'no_plan') return { tag: null, line: `Members can't buy it in the app until this ${it} has a plan.` };
  if (state === 'ready') return { tag: 'Sold in the app', line: null };
  if (state === 'connect') return { tag: null, line: "Members can't buy it in the app until Square is connected." };
  if (state === 'location') return { tag: null, line: "Members can't buy it in the app until your Square location is chosen." };
  if (state === 'country') return { tag: null, line: "Members can't buy it in the app: selling in the app isn't available in your country yet." };
  if (state === 'off') return { tag: null, line: "Members can't buy it in the app yet." };
  return { tag: 'Sell in the app: on', line: null };
}

/** Under the cooling-off box: what the days typed mean, where they read. */
export function coolingOffHint(draft) {
  if (String(draft.coolingOffDays ?? '').trim() === '') return 'Days after they sign in which members can cancel with a full refund. Weekends count. Leave empty for none.';
  const days = wholeNumber(draft.coolingOffDays, 1, MEMBERSHIP_COOLING_OFF_DAYS_MAX);
  if (days === null) return null;
  return `For ${days === 1 ? '1 day' : `${String(days)} days`} after they sign, members can cancel with a full refund. Weekends count.`;
}

/** Under the notice box: what the days typed mean, where they read. */
export function noticeHint(draft) {
  const days = wholeNumber(draft.noticeDays, 1, MEMBERSHIP_NOTICE_DAYS_MAX);
  if (String(draft.noticeDays ?? '').trim() === '') return 'Leave empty for no notice: members can stop at the end of what they have paid.';
  if (days === null) return null;
  return `Members who cancel give ${String(days)} day${days === 1 ? "'s" : "s'"} notice: they stay, and pay, to the end of the payment period it ends in.`;
}

/** Under the contract boxes: how long so many payments run, where the number reads. */
export function contractHint(draft) {
  const periods = wholeNumber(draft.contractPeriods, 1, MEMBERSHIP_CONTRACT_PERIODS_MAX);
  const count = wholeNumber(draft.termCount, 1, MEMBERSHIP_TERM_COUNT_MAX);
  if (periods === null || count === null) return null;
  const length = contractLengthWords(periods, count, draft.termUnit);
  return draft.contractThen === 'ends'
    ? `They stay ${length}, then it ends.`
    : `They stay at least ${length}. After that, it renews until they cancel.`;
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
    includesPt: false,
    ptAccess: 'none',
    ptLimit: '4',
    ptPeriod: 'month',
    taxRateIds: [],
    joiningFee: '',
    contract: 'none',
    contractPeriods: '12',
    contractThen: 'renews',
    leaveFee: '',
    noticeDays: '',
    coolingOffDays: '',
    renewalReminderDays: '',
    termReminderDays: '',
    soldInApp: false,
    // Members already on it, where a change raises its price (18w).
    ...RAISE_DRAFT,
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
    classScope: type.classTypes === null ? 'all' : ptOnly(type) && choice === 'pack' ? 'none' : 'some',
    classIds: type.classTypes === null ? [] : type.classTypes.map((c) => c.id),
    includesPt: type.includesPt === true,
    ptAccess: hasPtLimit(type) ? 'limited' : 'none',
    ptLimit: hasPtLimit(type) ? String(type.ptLimit) : base.ptLimit,
    ptPeriod: hasPtLimit(type) ? type.ptPeriod : base.ptPeriod,
    taxRateIds: [...(type.taxRateIds ?? [])],
    joiningFee: type.joiningFeeMinor > 0 ? minorToPriceText(type.joiningFeeMinor, type.currency) : '',
    contract: type.contractPeriods === null || type.contractPeriods === undefined ? 'none' : 'fixed',
    contractPeriods: type.contractPeriods === null || type.contractPeriods === undefined ? base.contractPeriods : String(type.contractPeriods),
    contractThen: type.contractThen ?? base.contractThen,
    leaveFee: type.leaveFeeMinor > 0 ? minorToPriceText(type.leaveFeeMinor, type.currency) : '',
    noticeDays: type.noticeDays === null || type.noticeDays === undefined ? '' : String(type.noticeDays),
    coolingOffDays: type.coolingOffDays === null || type.coolingOffDays === undefined ? '' : String(type.coolingOffDays),
    renewalReminderDays: type.renewalReminderDays > 0 ? String(type.renewalReminderDays) : '',
    termReminderDays: type.termReminderDays > 0 ? String(type.termReminderDays) : '',
    soldInApp: type.soldInApp === true,
    savedPriceMinor: type.priceMinor,
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

/** "25.00" for dollars, "2500" for a currency with no decimals. */
export function joiningFeeExample(currency) {
  return currencyDecimals(currency) === 0 ? '2500' : '25.00';
}

/** The early cancellation fee the form holds in minor units (18v-ii-b): 0 where it is empty or there
 *  is no minimum term, null where what is typed is not an amount above 0. */
function draftLeaveFee(draft, currency) {
  if (!draftHasContract(draft) || String(draft.leaveFee ?? '').trim() === '') return 0;
  const minor = priceToMinor(draft.leaveFee, currency);
  return minor === null || minor === 0 ? null : minor;
}

/** The joining fee the form holds in minor units: 0 where it is empty or the kind has none,
 *  null where what is typed is not an amount. */
function draftJoiningFee(draft, currency) {
  if (!usesJoiningFee(draft.choice) || draft.joiningFee.trim() === '') return 0;
  return priceToMinor(draft.joiningFee, currency);
}

const usesTerm = (choice) => choice === 'recurring' || choice === 'one_time' || choice === 'trial';
const usesAccess = usesTerm;

/** The boxes in the order the form draws them, so the first wrong one can be shown. */
export const PROBLEM_ORDER = ['name', 'description', 'price', 'raise', 'joiningFee', 'tax', 'termCount', 'contractPeriods', 'leaveFee', 'noticeDays', 'coolingOffDays', 'renewalReminderDays', 'termReminderDays', 'packClasses', 'packDays', 'bookingsLimit', 'classes', 'ptLimit', 'soldInApp'];

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

/** What is wrong with the form, one sentence a field, or null when it can be saved. `rates` are
 *  the gym's, to say what the taxes ticked come to together (18b-v-b). */
export function draftProblems(draft, currency, rates = []) {
  const taxed = draft.taxRateIds.length > 0;
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
  const priceMinor = priceToMinor(draft.price, currency);
  if (priceMinor === null) {
    problems.price = `Type the price as a number, like ${priceExample(currency)}. Type 0 for free.`;
  } else if (taxed && priceMinor > TAXED_PRICE_MINOR_MAX) {
    problems.price = `A price with tax can be at most ${formatMinor(TAXED_PRICE_MINOR_MAX, currency)}. Lower the price, or untick the taxes.`;
  } else if (taxed && priceMinor === 0) {
    problems.tax = 'A free membership charges no tax. Untick the taxes.';
  }
  const ticked = rates.filter((r) => draft.taxRateIds.includes(r.id));
  if (problems.tax === undefined && ticked.reduce((n, r) => n + r.pcm, 0) > SALES_TAX_PCM_MAX) {
    problems.tax = `These taxes come to ${togetherText(ticked)} together. A membership's taxes can come to 30% at most. Untick one.`;
  }
  const feeMinor = draftJoiningFee(draft, currency);
  if (feeMinor === null) {
    problems.joiningFee = `Type the joining fee as a number, like ${joiningFeeExample(currency)}, or leave it empty.`;
  } else if (feeMinor > 0 && priceMinor === 0) {
    problems.joiningFee = 'A free membership has no joining fee. Leave it empty.';
  } else if (feeMinor > 0 && priceMinor !== null) {
    const cap = taxed ? TAXED_PRICE_MINOR_MAX : MEMBERSHIP_PRICE_MINOR_MAX;
    if (priceMinor + feeMinor > cap) problems.joiningFee = `The price and joining fee together can be at most ${formatMinor(cap, currency)}.`;
  }
  if (usesTerm(draft.choice) && wholeNumber(draft.termCount, 1, MEMBERSHIP_TERM_COUNT_MAX) === null) {
    problems.termCount = `Type a whole number from 1 to ${String(MEMBERSHIP_TERM_COUNT_MAX)}.`;
  }
  if (draftHasContract(draft)) {
    if (wholeNumber(draft.contractPeriods, 1, MEMBERSHIP_CONTRACT_PERIODS_MAX) === null) {
      problems.contractPeriods = `Type how many payments, from 1 to ${String(MEMBERSHIP_CONTRACT_PERIODS_MAX)}.`;
    } else if (priceMinor === 0) {
      problems.contractPeriods = 'A free membership has no minimum term. Choose No minimum term.';
    }
  }
  const leaveMinor = draftLeaveFee(draft, currency);
  if (leaveMinor === null) {
    problems.leaveFee = `Type the early cancellation fee as a number, like ${joiningFeeExample(currency)}, or leave it empty.`;
  } else if (leaveMinor > MEMBERSHIP_PRICE_MINOR_MAX) {
    problems.leaveFee = `The early cancellation fee can be at most ${formatMinor(MEMBERSHIP_PRICE_MINOR_MAX, currency)}.`;
  }
  if (draftHasNotice(draft)) {
    if (wholeNumber(draft.noticeDays, 1, MEMBERSHIP_NOTICE_DAYS_MAX) === null) {
      problems.noticeDays = `Type how many days, from 1 to ${String(MEMBERSHIP_NOTICE_DAYS_MAX)}, or leave it empty.`;
    } else if (priceMinor === 0) {
      problems.noticeDays = 'A free membership has no notice to cancel. Leave it empty.';
    } else if (draftHasContract(draft) && draft.contractThen === 'ends') {
      problems.noticeDays = 'A minimum term that ends by itself has no notice to cancel. Leave it empty.';
    }
  }
  if (draftHasCoolingOff(draft)) {
    if (wholeNumber(draft.coolingOffDays, 1, MEMBERSHIP_COOLING_OFF_DAYS_MAX) === null) {
      problems.coolingOffDays = `Type how many days, from 1 to ${String(MEMBERSHIP_COOLING_OFF_DAYS_MAX)}, or leave it empty.`;
    } else if (priceMinor === 0) {
      problems.coolingOffDays = 'A free membership has no cooling-off period. Leave it empty.';
    }
  }
  if (draftHasReminder(draft)) {
    const offered = reminderDayOptions('every_renewal', draft.termCount, draft.termUnit).map((o) => o.value);
    if (priceMinor === 0) problems.renewalReminderDays = 'A free membership has no renewal reminder. Choose No reminder.';
    else if (!offered.includes(draft.renewalReminderDays)) problems.renewalReminderDays = 'That is longer than one payment. Choose fewer days before.';
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
  if (draftLimitsPt(draft) && wholeNumber(draft.ptLimit, 1, MEMBERSHIP_PT_LIMIT_MAX) === null) {
    problems.ptLimit = `Type how many sessions, from 1 to ${String(MEMBERSHIP_PT_LIMIT_MAX)}.`;
  }
  if (draftSellsInApp(draft) && priceMinor === 0) problems.soldInApp = "A free membership can't be sold in the app. Untick Sell in the app.";
  const raise = raiseProblem(draft, currency);
  if (raise !== null) problems.raise = raise;
  return Object.keys(problems).length === 0 ? null : problems;
}

/** Whether the form sells it in the app: ticked, on a way of paying that can be (18k-i). */
export function draftSellsInApp(draft) {
  return draft.soldInApp === true && usesSellInApp(draft.choice);
}

/** Whether the form sets a contract: a repeating type only (18v-i). */
export function draftHasContract(draft) {
  return draft.choice === 'recurring' && draft.contract === 'fixed';
}

/** Whether the form sets a notice to cancel: a repeating type with days typed (18v-ii-a). */
export function draftHasNotice(draft) {
  return draft.choice === 'recurring' && String(draft.noticeDays ?? '').trim() !== '';
}

/** Whether the form sets a cooling-off period: days typed, on any kind (18v-iii). */
export function draftHasCoolingOff(draft) {
  return String(draft.coolingOffDays ?? '').trim() !== '';
}

/** Whether the form sets a renewal reminder: a repeating type with a choice picked (18v-iv). */
export function draftHasReminder(draft) {
  return draft.choice === 'recurring' && (draft.renewalReminderDays ?? '') !== '';
}

/** Whether the form sets a reminder before its minimum term ends: a minimum term, and days picked (18v-iv). */
export function draftHasTermReminder(draft) {
  return draftHasContract(draft) && (draft.termReminderDays ?? '') !== '';
}

/** Whether the form's ticked classes apply: not for a gym-only type. */
function coversSomeClasses(draft) {
  const gymOnly = usesAccess(draft.choice) && draft.access === 'gym_only';
  return !gymOnly && draft.classScope === 'some';
}

/** A class pack set to "No classes: personal training only". */
export function packForPtOnly(draft) {
  return draft.choice === 'pack' && draft.classScope === 'none';
}

/** Whether the type includes personal training: the tick, or a pack for nothing else. A
 *  day pass is one visit and never does. */
export function draftIncludesPt(draft) {
  return draft.choice !== 'day_pass' && (draft.includesPt === true || packForPtOnly(draft));
}

/** Whether the form can hold personal training to a number of sessions: a membership that
 *  includes it. A pack's own count is its limit. */
export function canLimitPt(draft) {
  return usesTerm(draft.choice) && draftIncludesPt(draft);
}

/** Whether the form sets a limit on personal training sessions. */
export function draftLimitsPt(draft) {
  return canLimitPt(draft) && draft.ptAccess === 'limited';
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
    classTypeIds: packForPtOnly(draft) ? [] : coversSomeClasses(draft) ? [...draft.classIds] : null,
    includesPt: draftIncludesPt(draft),
    ptLimit: draftLimitsPt(draft) ? wholeNumber(draft.ptLimit, 1, MEMBERSHIP_PT_LIMIT_MAX) : null,
    ptPeriod: draftLimitsPt(draft) ? draft.ptPeriod : null,
    taxRateIds: [...draft.taxRateIds],
    joiningFeeMinor: draftJoiningFee(draft, currency),
    contractPeriods: draftHasContract(draft) ? wholeNumber(draft.contractPeriods, 1, MEMBERSHIP_CONTRACT_PERIODS_MAX) : null,
    contractThen: draftHasContract(draft) ? draft.contractThen : null,
    leaveFeeMinor: ((minor) => (minor === null || minor === 0 ? null : minor))(draftLeaveFee(draft, currency)),
    noticeDays: draftHasNotice(draft) ? wholeNumber(draft.noticeDays, 1, MEMBERSHIP_NOTICE_DAYS_MAX) : null,
    coolingOffDays: draftHasCoolingOff(draft) ? wholeNumber(draft.coolingOffDays, 1, MEMBERSHIP_COOLING_OFF_DAYS_MAX) : null,
    renewalReminderDays: draftHasReminder(draft) ? Number(draft.renewalReminderDays) : null,
    termReminderDays: draftHasTermReminder(draft) ? Number(draft.termReminderDays) : null,
    soldInApp: draftSellsInApp(draft),
    // A change says which version of the type the form read.
    ...(draft.id === null ? {} : { updatedAt: draft.updatedAt }),
    // Members already on it, ticked, pay its new, higher price too (18w).
    ...(draft.id === null ? {} : raiseBody(draft, currency)),
  };
}

/** The form after its kind changes: a repeating type cannot be charged by the day. */
export function withChoice(draft, choice) {
  const termUnit = choice === 'recurring' && draft.termUnit === 'day' ? 'month' : draft.termUnit;
  // "No classes: personal training only" is a pack's choice; another kind says it with
  // "No classes, gym only" and the tick.
  const classScope = choice !== 'pack' && draft.classScope === 'none' ? 'all' : draft.classScope;
  return { ...draft, choice, termUnit, classScope };
}
