import { orgWords } from '@app/shared';
import { canOpenPlace, placeTo } from './consolePlaces';
import { consoleIsReadOnly, readOnlyNote } from './billingView';
import { keepsMemberList } from './consoleView';

// NEW, IN THE BAR ACROSS THE TOP (spec Part 3 §17.11). It lists what this person may add, and
// each line opens the box that page already has; New makes nothing itself. A line is drawn
// only for whoever that page shows its own button to, so nobody is offered what they cannot do.

/** In the order the Overview board draws them. `icon` names a page's own menu icon. */
const NEW_ITEMS = [
  { key: 'addMember', place: 'addMember', icon: 'members', label: (words) => `Add ${words.person}`, also: keepsMemberList },
  { key: 'addLead', place: 'addLead', icon: 'leads', label: () => 'Add lead' },
  { key: 'newSale', place: 'newSale', icon: 'sell', label: () => 'New sale' },
  { key: 'addClass', place: 'addClass', icon: 'classes', label: () => 'Add class' },
  { key: 'checkIn', place: 'checkIn', icon: 'attendance', label: () => 'Check in' },
  { key: 'newPost', place: 'newPost', icon: 'updates', label: () => 'New post' },
];

/** What New offers: `items` this person may add, each `{ key, label, to, icon }`. While the
 *  business can change nothing (§4.2) it offers none, and says why to whoever it would have
 *  offered something; somebody who may add nothing gets no New either way. */
export function newMenu(orgSlug, privileges, org) {
  const words = orgWords(org?.orgType);
  // Add member opens on Members only for staff who keep the list, narrower than who may open
  // Members; `also` is that page's own rule.
  const items = NEW_ITEMS.filter((item) => canOpenPlace(privileges, item.place) && (item.also === undefined || item.also(privileges)))
    .map((item) => ({ key: item.key, label: item.label(words), to: placeTo(orgSlug, item.place), icon: item.icon }))
    .filter((item) => item.to !== null);
  if (consoleIsReadOnly(org)) return { items: [], note: items.length > 0 ? readOnlyNote(org?.orgType) : null };
  return { items, note: null };
}
