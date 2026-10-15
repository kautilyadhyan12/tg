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
// with them. The member's gift comes off their next payment by itself (20e-ii-b); the
// friend's gift gets a promo code the app makes when it is saved. Every sentence about a
// gift is the server's own (`referralMemberGiftWords`, `referralGiftInputWords`,
// `referralOfferLines`, `inviteLines`).

/** What the friend's gift comes off, in the box's words. */
export const GIFT_ON_CHOICES = [
  { key: 'first', label: 'the first payment of a new membership' },
  { key: 'every', label: 'every payment of a new membership' },
  { key: 'products', label: 'products sold at the desk' },
];

/** Where the friend's code stands in a preview before it is made. */
export const CODE_TO_COME = '[its code, made when you save]';

const NO_GIFT = { give: 'none', value: '', on: 'first' };

function giftDraft(view) {
  if (view === null || view === undefined) return NO_GIFT;
  const on = view.on ?? 'first';
  if (view.kind === 'percent') return { give: 'percent', value: bpToPercentText(view.percentBp ?? 0), on };
  return { give: 'amount', value: minorToPriceText(view.amountMinor ?? 0, view.currency ?? 'USD'), on };
}

export function referralDraft(settings) {
  return { on: settings.on, member: giftDraft(settings.member), friend: giftDraft(settings.friend) };
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

export function referralBody(draft, settings) {
  return { on: draft.on, member: amountBody(draft.member, settings.currency) ?? null, friend: friendBody(draft.friend, settings.currency) ?? null };
}

export function referralChanged(draft, settings) {
  const now = referralDraft(settings);
  // The member's gift has no "off what": only what is typed counts.
  const same = (a, b, withOn) => a.give === b.give && a.value === b.value && (!withOn || a.on === b.on);
  return draft.on !== now.on || !same(draft.member, now.member, false) || !same(draft.friend, now.friend, true);
}

/** What is wrong with one gift as typed; null when it is fine. */
export function giftProblem(gift, currency) {
  if (gift.give === 'none') return null;
  if (gift.give === 'amount' && currency === null) return REFERRAL_WORDS.no_currency;
  if (amountBody(gift, currency) !== undefined) return null;
  return gift.give === 'percent' ? 'Type a percentage above 0 and under 100, like 10.' : 'Type an amount, like 500.';
}

/** What stops Save, said in one line; null when it can be saved. */
export function referralProblem(draft, settings) {
  const own = giftProblem(draft.member, settings.currency) ?? giftProblem(draft.friend, settings.currency);
  if (own !== null) return own;
  if (draft.on && draft.member.give === 'none' && draft.friend.give === 'none') return REFERRAL_WORDS.no_gift;
  return null;
}

const memberWords = (draft, currency) => {
  const body = amountBody(draft.member, currency);
  return body === null || body === undefined ? null : referralMemberGiftWords({ ...body, currency });
};
const friendWords = (draft, currency) => {
  const body = friendBody(draft.friend, currency);
  return body === null || body === undefined ? null : referralGiftInputWords(body, currency);
};

/** The saved friend's code, while the box still holds that same gift; null otherwise. */
function savedCode(settings, draft) {
  const view = settings.friend;
  if (view === null || view.code === null || view.problem !== null) return null;
  return JSON.stringify(friendBody(draft.friend, settings.currency)) === JSON.stringify(friendBody(giftDraft(view), settings.currency)) ? view.code : null;
}

/** What a member reads, with the gifts as typed. */
export function memberPreview(draft, settings, gymName) {
  return referralOfferLines(gymName, memberWords(draft, settings.currency), friendWords(draft, settings.currency));
}

/** What a friend reads on the invite page, with the gift as typed. The member's first name
 *  stands as "[member's first name]". */
export function friendPreview(draft, settings, gymName) {
  const words = friendWords(draft, settings.currency);
  return inviteLines(gymName, words === null ? null : { code: savedCode(settings, draft) ?? CODE_TO_COME, words }, "[member's first name]");
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
