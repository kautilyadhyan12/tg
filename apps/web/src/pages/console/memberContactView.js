import { GYM_CONTACT_WORDS, cleanGymContactEmail, cleanGymContactPhone, orgWords } from '@app/shared';

// SETTINGS → HOW MEMBERS REACH YOU (ROADMAP 20a-iii). Pure: the box draws what these return.
// The rules for a phone number and an email address are the server's own, from
// `@app/shared`, so the box and the server refuse the same things in the same words.

const text = (value) => (typeof value === 'string' ? value : '');

/** The two boxes, from the gym the console holds. Nothing is filled in for a gym that has
 *  added neither: not the owner's mobile for payments, not the address leads reply to. */
export function memberContactDraft(org) {
  return { phone: text(org?.contactPhone), email: text(org?.contactEmail) };
}

/** Has anything been typed that differs from what is kept? */
export function memberContactChanged(draft, kept) {
  return draft.phone.trim() !== kept.phone.trim() || draft.email.trim() !== kept.email.trim();
}

/** What is wrong with what is typed, or null. An empty box is fine: both are optional. */
export function memberContactProblem(draft) {
  if (draft.phone.trim() !== '' && cleanGymContactPhone(draft.phone) === null) return GYM_CONTACT_WORDS.bad_contact_phone;
  if (draft.email.trim() !== '' && cleanGymContactEmail(draft.email) === null) return GYM_CONTACT_WORDS.bad_contact_email;
  return null;
}

/** What Save sends: only the box that changed, and null for one that was emptied. Null
 *  when nothing changed. */
export function memberContactPatch(draft, kept) {
  const patch = {};
  if (draft.phone.trim() !== kept.phone.trim()) patch.contactPhone = draft.phone.trim() === '' ? null : draft.phone.trim();
  if (draft.email.trim() !== kept.email.trim()) patch.contactEmail = draft.email.trim() === '' ? null : draft.email.trim();
  return Object.keys(patch).length === 0 ? null : patch;
}

/** The section's heading, in the organisation's own word for its people. */
export function memberContactTitle(orgType) {
  return `How ${orgWords(orgType).people} reach you`;
}

/** The line beside the heading while the section is shut: what is kept, or that nothing is. */
export function memberContactSummary(kept, orgType) {
  const have = [kept.phone.trim(), kept.email.trim()].filter((value) => value !== '');
  return have.length === 0 ? `Not added yet. Your ${orgWords(orgType).people} have no phone number or email for you in the app.` : have.join(' · ');
}

/** Said above the boxes: who sees these, and where. */
export function memberContactNote(orgType) {
  const words = orgWords(orgType);
  return `Your ${words.people} see these in the app: in their Inbox, under "Contact the ${words.itToMembers}". They can't reply to your messages there, so this is how they call or write to you. Add one or both.`;
}
