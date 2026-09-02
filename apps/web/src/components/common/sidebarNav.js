import { Building2 } from 'lucide-react';

/** MY GYMS — Kd's ruling of 2026-09-02: *"whenever a user joins a gym and gym
 *  approves them a new option will appear besides the other option in left
 *  called my gyms ... it will appear only after a gym approves a memebr
 *  joining"*.
 *
 *  **IT IS NOT THE `My Gym` THAT WAS REMOVED FROM THIS LIST, AND CONFLATING
 *  THEM WOULD REVERSE A KD RULING BY ACCIDENT.** The item he deleted on
 *  2026-08-19 (:11616) pointed at `/console` — a shortcut into the gym OWNER's
 *  console, and that crossing stays shut in both directions with the login
 *  page's two doors the only way across. This one points at a MEMBER screen
 *  about the member's own gym. `loginDoorCrossing.render.test.jsx` asserts both
 *  halves together: the console link is absent, and the member item is present
 *  and goes somewhere else.
 *
 *  **THE GATE IS MEMBERSHIP, NOT AN APPLICATION.** Somebody still waiting sees
 *  nothing here; their status stays on Settings → Gym, where they applied and
 *  where the code box remains (Kd, same message).
 *
 *  **Placed immediately before Settings rather than at a counted index.** An
 *  item inserted at a number moves every time this list grows, and it has grown
 *  four times; anchoring on the neighbour it must sit beside is what survives
 *  the fifth.
 *
 *  In its own module rather than beside the component because the sidebar file
 *  may export components only (`react-refresh/only-export-components`) — and
 *  the list it edits deliberately stays in `Sidebar.jsx`, where the removal
 *  ruling's own comment and the mutation harness that guards it both live. */
export function navWithMyGyms(items, gymCount) {
  if (!Array.isArray(items) || !Number.isInteger(gymCount) || gymCount <= 0) return items;
  const myGyms = { to: '/my-gyms', icon: Building2, label: 'My Gyms' };
  const at = items.findIndex((item) => item.to === '/settings');
  if (at < 0) return [...items, myGyms];
  return [...items.slice(0, at), myGyms, ...items.slice(at)];
}
