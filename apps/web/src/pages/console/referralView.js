import {
  REFERRAL_WORDS,
  bpToPercentText,
  inviteLines,
  minorToPriceText,
  percentToBp,
  priceToMinor,
  referralGiftInputWords,
  referralMemberGiftWords,
  referralOfferLines,
} from '@app/shared';

// REFER A FRIEND IN SETTINGS (ROADMAP 20e-ii-a): the switch and the two gifts, each typed
// in the box itself, kept as typed until Save, and what a member and a friend will read
// with them. The member's gift is money off their next membership payment or their next
// purchase at the desk, or free days on their membership with money off for a member who
// has none then (20e-ii-b-ii-b); it is given by itself. The friend's gift gets a promo code
// the app makes when it is saved. Every sentence about a gift is the server's own
// (`referralMemberGiftWords`, `referralGiftInputWords`, `referralOfferLines`, `inviteLines`).

/** What the friend's gift comes off, in the box's words. */
export const GIFT_ON_CHOICES = [
  { key: 'first', label: 'the first payment of a new membership' },
  { key: 'every', label: 'every payment of a new membership' },
  { key: 'products', label: 'products sold at the desk' },
];

/** What the member's money off comes off, in the box's words. */
export const MEMBER_GIFT_ON_CHOICES = [
  { key: 'membership', label: 'their next membership payment' },
  { key: 'products', label: 'products bought at the desk' },
];

/** The most free days one gift gives (the server's `GIFT_DAYS_MAX`). */
export const GIFT_DAYS_MOST = 90;

const NO_GIFT = { give: 'none', value: '', on: 'first' };
const NO_MEMBER_GIFT = { give: 'none', value: '', on: 'membership', days: '', backupGive: 'percent', backupValue: '' };

const amountText = (view) =>
  view.kind === 'percent' ? bpToPercentText(view.percentBp ?? 0) : minorToPriceText(view.amountMinor ?? 0, view.currency ?? 'USD');

function giftDraft(view) {
  if (view === null || view === undefined) return NO_GIFT;
  return { give: view.kind, value: amountText(view), on: view.on ?? 'first' };
}

/** The member's gift as the box holds it: money off (`give` percent or amount, `on`), or free
 *  days (`give` days) with the money for a member who has none (`backupGive`, `backupValue`). */
function memberDraft(view) {
  if (view === null || view === undefined) return NO_MEMBER_GIFT;
  if (typeof view.days === 'number') return { ...NO_MEMBER_GIFT, give: 'days', days: String(view.days), backupGive: view.kind, backupValue: amountText(view) };
  return { ...NO_MEMBER_GIFT, give: view.kind, value: amountText(view), on: view.on ?? 'membership' };
}

export function referralDraft(settings) {
  return { on: settings.on, member: memberDraft(settings.member), friend: giftDraft(settings.friend) };
}

/** What is typed as an amount off, as the server takes it; null for no gift, undefined
 *  where what is typed is not one yet. */
function amountBody(gift, currency) {
  if (gift.give === 'none') return null;
  if (gift.give === 'percent') {
    const bp = percentToBp(gift.value);
    return bp === null ? undefined : { kind: 'percent', percentBp: bp, amountMinor: null };
  }
  const minor = currency === null ? null : priceToMinor(gift.value, currency);
  return minor === null || minor < 1 ? undefined : { kind: 'amount', percentBp: null, amountMinor: minor };
}

/** The friend's gift: the amount and what it comes off. */
function friendBody(gift, currency) {
  const amount = amountBody(gift, currency);
  return amount === null || amount === undefined ? amount : { ...amount, on: gift.on };
}

/** The number of free days typed, from 1 to 90; null where it is not one. */
function daysTyped(text) {
  const t = String(text).trim();
  if (!/^\d{1,3}$/.test(t)) return null;
  const n = Number(t);
  return n >= 1 && n <= GIFT_DAYS_MOST ? n : null;
}

/** The member's gift, as the server takes it: null for none, undefined where what is typed
 *  is not one yet. */
function memberBody(gift, currency) {
  if (gift.give === 'none') return null;
  if (gift.give !== 'days') {
    const amount = amountBody(gift, currency);
    return amount === null || amount === undefined ? amount : { ...amount, on: gift.on, days: null };
  }
  const days = daysTyped(gift.days);
  const backup = amountBody({ give: gift.backupGive, value: gift.backupValue }, currency);
  return days === null || backup === null || backup === undefined ? undefined : { ...backup, on: 'membership', days };
}

/** What Save sends: the offer as typed, and the version it was read at, so a save made
 *  since in another tab refuses this one instead of being undone by it. */
export function referralBody(draft, settings) {
  return {
    on: draft.on,
    member: memberBody(draft.member, settings.currency) ?? null,
    friend: friendBody(draft.friend, settings.currency) ?? null,
    version: settings.version,
  };
}

export function referralChanged(draft, settings) {
  const now = referralDraft(settings);
  const same = (a, b, withOn) => a.give === b.give && a.value === b.value && (!withOn || a.on === b.on);
  // The member's gift: only what its choice shows counts.
  const a = draft.member;
  const b = now.member;
  const sameMember =
    a.give === b.give &&
    (a.give === 'none' ||
      (a.give === 'days' ? a.days === b.days && a.backupGive === b.backupGive && a.backupValue === b.backupValue : a.value === b.value && a.on === b.on));
  return draft.on !== now.on || !sameMember || !same(draft.friend, now.friend, true);
}

/** What is wrong with one gift as typed; null when it is fine. */
export function giftProblem(gift, currency) {
  if (gift.give === 'none') return null;
  if (gift.give === 'amount' && currency === null) return REFERRAL_WORDS.no_currency;
  if (amountBody(gift, currency) !== undefined) return null;
  return gift.give === 'percent' ? 'Type a percentage above 0 and under 100, like 10.' : 'Type an amount, like 500.';
}

/** What is wrong with the member's gift as typed; null when it is fine. Free days ask for
 *  their number, and for the money a member with no membership gets. */
export function memberGiftProblem(gift, currency) {
  if (gift.give !== 'days') return giftProblem(gift, currency);
  if (daysTyped(gift.days) === null) return `Type a number of days from 1 to ${String(GIFT_DAYS_MOST)}, like 14.`;
  const backup = { give: gift.backupGive, value: gift.backupValue };
  if (gift.backupValue.trim() === '') return 'Choose what a member with no membership gets instead.';
  return giftProblem(backup, currency);
}

/** What stops Save, said in one line; null when it can be saved. */
export function referralProblem(draft, settings) {
  const own = memberGiftProblem(draft.member, settings.currency) ?? giftProblem(draft.friend, settings.currency);
  if (own !== null) return own;
  if (draft.on && draft.member.give === 'none' && draft.friend.give === 'none') return REFERRAL_WORDS.no_gift;
  return null;
}

const memberWords = (draft, currency) => {
  const body = memberBody(draft.member, currency);
  return body === null || body === undefined ? null : referralMemberGiftWords({ ...body, currency });
};
const friendWords = (draft, currency) => {
  const body = friendBody(draft.friend, currency);
  return body === null || body === undefined ? null : referralGiftInputWords(body, currency);
};

/** What a member reads, with the gifts as typed. */
export function memberPreview(draft, settings, gymName) {
  return referralOfferLines(gymName, memberWords(draft, settings.currency), friendWords(draft, settings.currency));
}

/** What a friend reads on the invite page, with the gift as typed: no code, which stays
 *  with the business. The member's first name stands as "[member's first name]". */
export function friendPreview(draft, settings, gymName) {
  const words = friendWords(draft, settings.currency);
  return inviteLines(gymName, words === null ? null : { words }, "[member's first name]");
}

/** The line under the saved friend's gift: its code, or why nobody is promised it. */
export function friendCodeLine(settings) {
  const view = settings.friend;
  if (view === null) return null;
  if (view.problem !== null) {
    return view.archived ? `${view.problem} Nobody is promised this gift. Save to make a new code.` : `${view.problem} Nobody is promised this gift until it is changed in Discounts.`;
  }
  return view.code === null ? null : `Its promo code: ${view.code}.`;
}

/** The section's line while it is closed. */
export function referralSummary(settings) {
  if (settings === null) return 'Members invite their friends, with a gift you choose';
  return settings.on ? 'On' : 'Off';
}
