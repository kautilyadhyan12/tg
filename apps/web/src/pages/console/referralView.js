import { REFERRAL_WORDS, inviteLines, referralOfferLines } from '@app/shared';

// REFER A FRIEND IN SETTINGS (ROADMAP 20e-ii-a): the switch and the two promo codes, kept
// as typed until Save, and what a member and a friend will read with them. Every sentence
// about a gift is the server's own (`referralOfferLines`, `inviteLines`), from the words
// and the problem the server sent for each code, so the preview is what people will read.

export const NO_GIFT = '';

export function referralDraft(settings) {
  return {
    on: settings.on,
    memberDiscountId: settings.memberDiscountId ?? NO_GIFT,
    friendDiscountId: settings.friendDiscountId ?? NO_GIFT,
  };
}

const idOrNull = (value) => (value === NO_GIFT ? null : value);

export function referralBody(draft) {
  return { on: draft.on, memberDiscountId: idOrNull(draft.memberDiscountId), friendDiscountId: idOrNull(draft.friendDiscountId) };
}

export function referralChanged(draft, settings) {
  const now = referralDraft(settings);
  return draft.on !== now.on || draft.memberDiscountId !== now.memberDiscountId || draft.friendDiscountId !== now.friendDiscountId;
}

const optionOf = (settings, id) => (id === NO_GIFT ? null : (settings.discounts.find((d) => d.id === id) ?? null));

/** One code in the picker: "Thank you · THANKS10 · 10% off a membership". */
export function giftOption(discount) {
  return [discount.name, discount.code, discount.words].filter((part) => typeof part === 'string' && part !== '').join(' · ');
}

/** The codes the picker offers: those with a promo code, and the one picked now even if
 *  it has none any more, so the box never shows a choice it does not hold. */
export function giftChoices(settings, pickedId) {
  return settings.discounts.filter((d) => d.code !== null || d.id === pickedId);
}

/** What stops Save, said in one line; null when it can be saved. A code that starts later
 *  can be saved, and is said under its box. */
export function referralProblem(draft, settings) {
  if (!draft.on) return null;
  if (draft.memberDiscountId === NO_GIFT && draft.friendDiscountId === NO_GIFT) return REFERRAL_WORDS.no_gift;
  for (const id of [draft.memberDiscountId, draft.friendDiscountId]) {
    const d = optionOf(settings, id);
    if (d === null) continue;
    if (d.code === null) return `${d.name} has no promo code. Pick another, or give it a code under Discounts.`;
    if (d.status !== 'active' && d.status !== 'scheduled') return `${d.name}: ${d.problem} Pick another.`;
  }
  return null;
}

/** The line under a code's box: why it is not promised today, or null. */
export function giftNote(settings, id) {
  const d = optionOf(settings, id);
  if (d === null || d.problem === null) return null;
  return d.status === 'scheduled' ? `${d.problem} Until then, nobody is promised it.` : `${d.problem} Nobody is promised it.`;
}

/** A picked gift's words while it can be used today; null otherwise. */
const liveWords = (settings, id) => {
  const d = optionOf(settings, id);
  return d === null || d.problem !== null || d.code === null ? null : d.words;
};

/** What a member reads, with the codes as picked in the form. */
export function memberPreview(draft, settings, gymName) {
  return referralOfferLines(gymName, liveWords(settings, draft.memberDiscountId), liveWords(settings, draft.friendDiscountId));
}

/** What a friend reads on the invite page, with the codes as picked in the form. */
export function friendPreview(draft, settings, gymName) {
  const d = optionOf(settings, draft.friendDiscountId);
  const gift = d === null || d.problem !== null || d.code === null ? null : { code: d.code, words: d.words };
  return inviteLines(gymName, gift);
}

/** The section's line while it is closed. */
export function referralSummary(settings) {
  if (settings === null) return 'Members invite their friends, with a gift you choose';
  return settings.on ? 'On' : 'Off';
}
