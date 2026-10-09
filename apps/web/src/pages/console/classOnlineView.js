import { CLASS_ONLINE_LINK_BEFORE_MINUTES, classOnlineLinkSchema } from '@app/shared';

// ONLINE CLASSES ON THE CONSOLE (spec Part 3 §13.3; ROADMAP 17g): the words and the form
// of a time slot's, and one class's, "Online class" tick and its video link. The gym
// pastes its own link (Zoom, Google Meet, any other); the app hosts no video.

/** Under the tick, on every form that has it. */
export const ONLINE_HELP = `People who are booked see the link in the app from ${String(CLASS_ONLINE_LINK_BEFORE_MINUTES)} minutes before the class until it ends. Nobody else sees it.`;

/** Under the link box. */
export const ONLINE_LINK_HELP = 'Paste the link from Zoom, Google Meet or whatever you use. You can add it later.';

/** What a change does not do, said before Save. */
export const ONLINE_NOT_TOLD = "The app doesn't tell people who are already booked yet. Tell them yourself if this changes for them.";

export function onlineDraft(holder) {
  return {
    online: holder?.online === true,
    link: typeof holder?.onlineLink === 'string' ? holder.onlineLink : '',
  };
}

const typed = (draft) => (typeof draft?.link === 'string' ? draft.link.trim() : '');

/** The one thing wrong with what is typed, or null. An empty link is allowed: it is added later. */
export function onlineProblem(draft) {
  if (draft?.online !== true) return null;
  const link = typed(draft);
  if (link === '') return null;
  if (!classOnlineLinkSchema.safeParse(link).success) return 'Paste the whole link, starting with https://';
  return null;
}

/** What the server is sent: both keys, every time. */
export function onlineRequest(draft) {
  if (onlineProblem(draft) !== null) return null;
  const online = draft?.online === true;
  const link = typed(draft);
  return { online, onlineLink: online && link !== '' ? link : null };
}

/** Has the form changed what the time slot or class holds? */
export function onlineChanged(holder, draft) {
  const now = onlineRequest(draft);
  if (now === null) return true;
  const was = onlineRequest(onlineDraft(holder));
  return was === null || was.online !== now.online || was.onlineLink !== now.onlineLink;
}

/** A time slot's or a class's line: nothing for one at the gym. */
export function onlineLine(holder) {
  if (holder?.online !== true) return '';
  return typeof holder.onlineLink === 'string' && holder.onlineLink !== '' ? 'Online class · link added' : 'Online class · no link yet';
}

/** Is the link still to be added? The button then says so. */
export function onlineNeedsLink(holder) {
  return holder?.online === true && (typeof holder.onlineLink !== 'string' || holder.onlineLink === '');
}

/** The button that opens the form. */
export function onlineButton(holder) {
  if (holder?.online !== true) return 'Make it online';
  return onlineNeedsLink(holder) ? 'Add the link' : 'Change link';
}

/** What Save changes, said above it. `kind`: a time slot, or one class on the calendar. */
export function onlineScopeNote(kind, holder) {
  if (kind === 'slot') return 'This changes every coming class of this time slot, except a class you gave a link of its own.';
  return holder?.onlineAlone === true
    ? 'This changes this class only. It already has a link of its own.'
    : 'This changes this class only. It then keeps its own link when the time slot’s link changes.';
}
