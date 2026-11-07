// The words of Settings → Signed forms of deleted members (ROADMAP 18u-iii). `when` writes a day in
// the business's calendar.

export const deletedFormsAbout = (gymName) =>
  `When you delete a member for good, the waivers and membership agreements they signed at ${gymName} are kept here for six years, in case you need them for a claim. Only you can see them.`;

export const deletedFormsNotOwner = (gymName) => `Only the owner of ${gymName} can see the signed forms of deleted members.`;

/** The section's line while it is closed: how many are kept, whatever is searched. */
export function deletedFormsSummary(kept) {
  if (kept === null) return null;
  return kept === 0 ? 'None kept' : `${kept} kept`;
}

/** Whom the form is about: the member, never a parent who signed for them. A waiver deleted before
 *  its member's name was kept, and signed by a parent, has no name of its own to show. */
export function deletedFormPerson(form) {
  if (form.member !== null) return form.member;
  return form.signer === 'guardian' ? 'A child (name not kept)' : form.signedName;
}

export function deletedFormWhat(form) {
  if (form.kind === 'waiver') return 'Waiver';
  return form.agreementName === null ? 'Membership agreement' : `Membership agreement: ${form.agreementName}`;
}

export function deletedFormSignedLine(form, when) {
  const day = when(form.signedAt);
  const on = day === '' ? '' : ` on ${day}`;
  return form.signer === 'guardian' ? `Signed by ${form.signedName}, parent or guardian,${on}.` : `Signed${on}.`;
}

export function deletedFormKeptLine(form, when) {
  return `Deleted on ${when(form.deletedAt)}. Kept until ${when(form.keptUntil)}.`;
}

export function deletedFormsEmptyLine(searched) {
  return searched === ''
    ? 'No signed forms are kept. When you delete a member for good, the waiver and membership agreements they signed appear here.'
    : `No signed forms match “${searched}”.`;
}

export const deletedFormsShownLine = (shown, total) => (shown < total ? `Showing ${shown} of ${total}.` : null);

/** Who was at the front desk when it was signed there; null from the emailed link or when they have left. */
export function deletedFormDeskLine(signed) {
  if (signed.by === null || signed.via !== 'desk') return null;
  return `Signed at the front desk with ${signed.by}.`;
}
