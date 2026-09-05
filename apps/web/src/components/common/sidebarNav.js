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
 *  ruling's own comment and the mutation harness that guards it both live.
 *
 *  **`dot` — THE WHOLE ARRIVAL OF A CHEER, added 2026-09-05 with Kd's approval
 *  at the web half's gate.** Nothing in this product sends anything (:29961 §4,
 *  measured), so a gym's cheer is STORED and waits on `My Gyms`; without
 *  something pointing at it, a member who does not open that screen never learns
 *  it happened. **It is RECENCY and not read-state** — `hasFreshCheer` — so it
 *  stays lit for the week whether or not they looked, which is the cost of not
 *  building a second table and a second write path for a dot.
 *
 *  **IT RIDES ON THE ITEM AND NOT ON A SECOND LIST**, so the dot cannot outlive
 *  the item it belongs to: a member removed from their last gym loses both in
 *  the same expression. */
export function navWithMyGyms(items, gymCount, { dot = false } = {}) {
  if (!Array.isArray(items) || !Number.isInteger(gymCount) || gymCount <= 0) return items;
  const myGyms = { to: '/my-gyms', icon: Building2, label: 'My Gyms', dot: dot === true };
  const at = items.findIndex((item) => item.to === '/settings');
  if (at < 0) return [...items, myGyms];
  return [...items.slice(0, at), myGyms, ...items.slice(at)];
}
