// Settings → Follow-up emails to leads (ROADMAP 20c-v; RULINGS 2026-09-27): the small
// rules of the "Send them for me" box, apart from the component so they are tested on
// their own. The server checks all of it again.
import { LEAD_EMAIL_SETTINGS_WORDS, authEmailSchema } from '@app/shared';

/** The boxes, from what the server holds. */
export function leadEmailsDraft(settings) {
  return { sendForMe: settings.sendForMe, replyTo: settings.replyTo ?? '' };
}

/** Ticking the switch with no reply address yet fills in the owner's own. */
export function tickSendForMe(draft, on, ownEmail) {
  const replyTo = on && draft.replyTo.trim() === '' ? (ownEmail ?? '') : draft.replyTo;
  return { sendForMe: on, replyTo };
}

/** Why Save cannot go yet, or null. */
export function leadEmailsProblem(draft, settings) {
  if (!draft.sendForMe) return null;
  if (!settings.hasPostalAddress) return LEAD_EMAIL_SETTINGS_WORDS.needs_postal_address;
  if (!authEmailSchema.safeParse(draft.replyTo).success) return 'Add the email address replies should go to.';
  return null;
}

const replyOf = (draft) => {
  const typed = draft.replyTo.trim().toLowerCase();
  return typed === '' ? null : typed;
};

/** Something differs from what the server holds. */
export function leadEmailsChanged(draft, settings) {
  return draft.sendForMe !== settings.sendForMe || replyOf(draft) !== (settings.replyTo ?? null);
}

/** What Save sends. An address that is not one is left out while the switch is off. */
export function leadEmailsBody(draft) {
  const replyTo = replyOf(draft);
  return { sendForMe: draft.sendForMe, replyTo: replyTo !== null && authEmailSchema.safeParse(replyTo).success ? replyTo : null };
}

/** "37 of 100 new leads emailed for you this month." */
export function usedThisMonthLine(settings) {
  return `${settings.usedThisMonth} of ${settings.perMonth} new leads emailed for you this month.`;
}
